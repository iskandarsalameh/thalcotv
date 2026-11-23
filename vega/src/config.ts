// Where the Thalco TV interface is served from. The shell loads this address
// on every launch, so whatever was last published there is what runs: pushing
// to the repository updates the app without reinstalling the .vpkg.
//
// CI overwrites this from the THALCO_APP_URL repository variable when set.
export const APP_URL = 'https://iskandarsalameh.github.io/thalcotv/';

export const SHELL_VERSION = '0.1.0';

/** Seconds to wait for the interface before offering a retry. */
export const LOAD_TIMEOUT_S = 25;
