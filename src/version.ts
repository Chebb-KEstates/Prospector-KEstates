/**
 * The single source of truth for the app's version number.
 *
 * This ONE constant is what the login screen shows, and it is kept in step with
 * `package.json` (front end + server) and the git tag `vX.Y.Z` for every release.
 * When you cut a release you change it HERE and in both package.json files, then
 * tag the commit — see docs/PROSPECTOR-HANDBOOK.md § "Versioning & releases".
 *
 * Format: MAJOR.MINOR.PATCH (semantic versioning).
 *   MAJOR — a change to the fundamentals (data shape, identity, permissions).
 *   MINOR — a new capability that doesn't break existing data.
 *   PATCH — a fix or polish that changes no data and adds no feature.
 */
export const APP_VERSION = '2.5.0';
