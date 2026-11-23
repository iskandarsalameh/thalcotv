/**
 * Thalco TV shell for Vega OS (Fire TV Stick 4K Select).
 *
 * The interface itself is a web app loaded from APP_URL, which is what makes
 * updates instant. This native layer only does what a web page cannot:
 *   - hosts the WebView and forwards the remote's Back key to it,
 *   - mirrors the app's saved data into native storage as a backup,
 *   - plays files the WebView cannot decode in the platform media player,
 *   - shows a retry screen when the interface cannot be reached.
 */
import * as React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, Pressable, StyleSheet, Text, View} from 'react-native';
import {WebView} from '@amazon-devices/webview';
import AsyncStorage from '@amazon-devices/react-native-async-storage__async-storage';
import {
  useHideSplashScreenCallback,
  usePreventHideSplashScreen,
} from '@amazon-devices/react-native-kepler';
import {APP_URL, BUNDLED_URL, LOAD_TIMEOUT_S, SHELL_VERSION} from './config';
import {NativePlayer, NativePlayRequest} from './NativePlayer';

const STORE_PREFIX = 'thalco:';

type Phase = 'restoring' | 'loading' | 'ready' | 'failed';

async function readStore(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k: string) =>
      k.startsWith(STORE_PREFIX),
    );
    const pairs = await AsyncStorage.multiGet(keys);
    pairs.forEach(([k, v]: [string, string | null]) => {
      if (typeof v === 'string') {
        out[k] = v;
      }
    });
  } catch (e) {
    console.warn('[thalco] could not read the storage backup', e);
  }
  return out;
}

/** Script that runs before the page: tells the web app what the shell offers. */
function bootstrapScript(store: Record<string, string>, bundled: boolean): string {
  const info = {
    shell: 'vega',
    shellVersion: SHELL_VERSION,
    platform: 'firetv',
    nativePlayer: true,
    // True when running the copy inside the package instead of the hosted one.
    bundled,
    store,
  };
  // JSON is valid JavaScript once the two Unicode line separators are escaped.
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const json = JSON.stringify(info)
    .split(LS)
    .join('\\u2028')
    .split(PS)
    .join('\\u2029')
    .split('<')
    .join('\\u003c');
  return `window.__THALCO_SHELL__ = ${json}; true;`;
}

export const App = () => {
  const webRef = useRef<any>(null);
  const [phase, setPhase] = useState<Phase>('restoring');
  const [attempt, setAttempt] = useState(0);
  const [bootstrap, setBootstrap] = useState('');
  const [failure, setFailure] = useState('');
  // Start with the hosted interface; fall back to the packaged copy if it cannot load.
  const [bundled, setBundled] = useState(false);
  const bundledRef = useRef(false);
  bundledRef.current = bundled;
  const [nativePlay, setNativePlay] = useState<NativePlayRequest | null>(null);
  const phaseRef = useRef<Phase>('restoring');
  phaseRef.current = phase;
  const nativeRef = useRef<NativePlayRequest | null>(null);
  nativeRef.current = nativePlay;

  usePreventHideSplashScreen();
  const hideSplash = useHideSplashScreenCallback();

  // 1. Read the storage backup, then start the WebView.
  useEffect(() => {
    let alive = true;
    readStore().then(store => {
      if (!alive) {
        return;
      }
      setBootstrap(bootstrapScript(store, bundledRef.current));
      setPhase('loading');
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  /** The interface could not be loaded: try the packaged copy once, then give up. */
  const loadFailed = useCallback(
    (reason: string) => {
      if (phaseRef.current === 'ready' || phaseRef.current === 'failed') {
        return;
      }
      if (!bundledRef.current) {
        console.warn('[thalco] hosted interface unavailable, using the packaged copy:', reason);
        setBundled(true);
        setPhase('restoring');
        setAttempt(n => n + 1);
        return;
      }
      setFailure(reason);
      setPhase('failed');
      hideSplash();
    },
    [hideSplash],
  );

  // 2. Give up waiting after a while and offer a retry.
  useEffect(() => {
    if (phase !== 'loading') {
      return;
    }
    const timer = setTimeout(() => {
      if (phaseRef.current === 'loading') {
        loadFailed('The Thalco TV interface did not respond in time.');
      }
    }, LOAD_TIMEOUT_S * 1000);
    return () => clearTimeout(timer);
  }, [phase, attempt, loadFailed]);

  const sendToWeb = useCallback((message: Record<string, unknown>) => {
    const payload = JSON.stringify(
      JSON.stringify({...message, __thalco: true}),
    );
    webRef.current?.injectJavaScript(
      `try{window.dispatchEvent(new MessageEvent('message',{data:${payload}}));}catch(e){};true;`,
    );
  }, []);

  const closeNative = useCallback(
    (reason: 'closed' | 'ended' | 'next' | 'error', detail?: string) => {
      if (!nativeRef.current) {
        return;
      }
      setNativePlay(null);
      if (reason === 'error') {
        sendToWeb({type: 'nativeError', message: detail ?? 'playback failed'});
      } else if (reason === 'ended') {
        sendToWeb({type: 'nativeEnded'});
      } else if (reason === 'next') {
        sendToWeb({type: 'nativeNext'});
      } else {
        sendToWeb({type: 'nativeClosed'});
      }
    },
    [sendToWeb],
  );

  // Back while the native player is up closes the player, never the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (nativeRef.current) {
        closeNative('closed');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [closeNative]);

  const onMessage = useCallback(
    (event: any) => {
      let msg: any;
      try {
        msg = JSON.parse(event?.nativeEvent?.data ?? '');
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') {
        return;
      }
      switch (msg.type) {
        case 'ready':
          setPhase('ready');
          hideSplash();
          break;
        case 'persist':
          if (typeof msg.key === 'string' && msg.key.startsWith(STORE_PREFIX)) {
            const op =
              typeof msg.value === 'string'
                ? AsyncStorage.setItem(msg.key, msg.value)
                : AsyncStorage.removeItem(msg.key);
            op.catch((e: unknown) => console.warn('[thalco] persist failed', e));
          }
          break;
        case 'nativePlay':
          if (msg.payload && typeof msg.payload.url === 'string') {
            setNativePlay(msg.payload as NativePlayRequest);
          }
          break;
        case 'nativeStop':
          setNativePlay(null);
          break;
        case 'exit':
          BackHandler.exitApp();
          break;
        case 'log':
          console.info('[thalco web]', msg.level, msg.message);
          break;
      }
    },
    [hideSplash],
  );

  const retry = useCallback(() => {
    setFailure('');
    setNativePlay(null);
    setBundled(false);
    bundledRef.current = false;
    setPhase('restoring');
    setAttempt(n => n + 1);
  }, []);

  return (
    <View style={styles.container}>
      {phase !== 'restoring' && phase !== 'failed' && (
        <WebView
          key={attempt}
          ref={webRef}
          style={styles.webview}
          source={{uri: bundled ? BUNDLED_URL : APP_URL}}
          injectedJavaScriptBeforeContentLoaded={bootstrap}
          onMessage={onMessage}
          allowSystemKeyEvents
          allowsDefaultMediaControl
          domStorageEnabled
          hasTVPreferredFocus
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="always"
          onLoad={() => {
            // The page reports "ready" itself once its script runs.
            hideSplash();
          }}
          onError={({nativeEvent}: any) => {
            console.error('[thalco] load error', nativeEvent?.code, nativeEvent?.description);
            loadFailed(String(nativeEvent?.description ?? 'Network error'));
          }}
          onHttpError={({nativeEvent}: any) => {
            console.error('[thalco] http error', nativeEvent?.statusCode, nativeEvent?.url);
            if (nativeEvent?.isMainFrame) {
              loadFailed('The server answered with error ' + nativeEvent?.statusCode + '.');
            }
          }}
          onCloseWindow={() => BackHandler.exitApp()}
        />
      )}

      {nativePlay && (
        <NativePlayer
          request={nativePlay}
          onProgress={(time, duration) =>
            sendToWeb({type: 'nativeProgress', time, duration})
          }
          onClose={closeNative}
        />
      )}

      {phase === 'failed' && (
        <View style={styles.failed}>
          <Text style={styles.brand}>thalco tv</Text>
          <Text style={styles.title}>Can't reach Thalco TV</Text>
          <Text style={styles.message}>
            {failure || 'Check the internet connection.'}
          </Text>
          <Pressable
            hasTVPreferredFocus
            onPress={retry}
            style={({focused}: any) => [styles.button, focused && styles.buttonFocused]}>
            {({focused}: any) => (
              <Text style={[styles.buttonText, focused && styles.buttonTextFocused]}>
                Try Again
              </Text>
            )}
          </Pressable>
          <Text style={styles.footnote}>{APP_URL}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#000000'},
  webview: {flex: 1, backgroundColor: '#000000'},
  failed: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 80,
  },
  brand: {color: '#8e8e93', fontSize: 28, fontWeight: '700', marginBottom: 40},
  title: {color: '#ffffff', fontSize: 44, fontWeight: '700'},
  message: {
    color: '#aeaeb2',
    fontSize: 28,
    marginTop: 16,
    marginBottom: 40,
    textAlign: 'center',
  },
  button: {
    paddingHorizontal: 44,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  buttonFocused: {backgroundColor: '#ffffff', transform: [{scale: 1.06}]},
  buttonText: {color: '#ffffff', fontSize: 30, fontWeight: '600'},
  buttonTextFocused: {color: '#000000'},
  footnote: {color: '#48484a', fontSize: 20, marginTop: 48},
});
