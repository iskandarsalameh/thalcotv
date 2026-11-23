// Where the Thalco TV interface is served from. The shell loads this address
// on every launch, so whatever was last published there is what runs: pushing
// to the repository updates the app without reinstalling the .vpkg.
//
// CI overwrites this from the THALCO_APP_URL repository variable when set.
export const APP_URL = 'https://iskandarsalameh.github.io/thalcotv/';

export const SHELL_VERSION = '0.1.0';

/**
 * Copy of the interface packaged inside the .vpkg at build time. Used when
 * APP_URL cannot be reached (no hosting set up yet, or the server is down),
 * so the app always starts. It only changes when the package is reinstalled.
 */
export const BUNDLED_URL = 'file:///pkg/assets/web/index.html';

/** Seconds to wait for the interface before falling back. */
export const LOAD_TIMEOUT_S = 15;
