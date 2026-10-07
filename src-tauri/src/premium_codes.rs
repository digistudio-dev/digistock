//! Empreintes SHA-256 des cinq codes maîtres DigiStock Premium.
//!
//! Les codes en clair ne sont JAMAIS stockés dans le dépôt ni dans le bundle JavaScript.
//! Pour remplacer un code : `npm run premium:hash -- <CODE>` puis collez l'empreinte ci-dessous.
//! Un emplacement vide ("") est désactivé.

pub const ACTIVATION_HASHES: [&str; 5] = [
    "c66c310a829c8a6d244d4b18bca8a25bba81aee12c30cf1b31d9125cf87da829",
    "a41159e40f7faf963f66e20677b846b368f992f09e556b3f9ac72e1a3b52b0c0",
    "1f3d360eb6755b6d2be3fb9a978ef748dcccd887b2d41c1c77710bbb1e1c0f0a",
    "9fe7646f488065ffb1e0c0c02847de71842c9c317a30de01c164ee1656283588",
    "9257d9823743037c92702dda02596f8f23e2052537a02ae2dc62086d4adce14e",
];
