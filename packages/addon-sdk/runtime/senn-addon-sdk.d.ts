// The runtime is a classic script that installs `window.senn` as a
// side-effect; the type surface lives in the package default entry
// (`@senn/addon-sdk`). This file exists only so projects that copy the
// runtime alongside their add-on source get a declaration shim and
// TypeScript stops warning about the .js path.
//
// See ADR-0018.
export {};
