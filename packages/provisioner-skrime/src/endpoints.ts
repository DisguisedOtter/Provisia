/**
 * Skrime reseller API endpoints used by the webspace and server provisioners.
 *
 * The domain endpoints (`domain/*`) are proven against the WHMCS reference module. The webspace and
 * server endpoints below follow the same naming scheme (`<product>/<verb>`, GET parameters in the query
 * string, POST bodies as JSON, `{ state, response, data }` envelope) but were written from the public
 * product pages, not from a live account: confirm each path and payload against
 * https://skrime.eu/docs (account area → "API Dokumentation") on the first live run and adjust here.
 * Nothing outside this file depends on the exact paths.
 */
export const SKRIME_ENDPOINTS = {
  /** Cheap read that validates the API key (used by `testConnection`). */
  productList: 'product/all',
  webspace: {
    /** GET → sellable webspace packages with prices. */
    packages: 'webspace/pricelist',
    /** POST { package, domain, tos: true } → { id, domain, status, ... } */
    order: 'webspace/order',
    /** GET ?id= → { id, status, domain, panel: { url, username }, usage... } */
    single: 'webspace/single',
    /** GET → all webspaces of the reseller account. */
    all: 'webspace/all',
    /** POST { id } → cancels at the end of the current term. */
    cancel: 'webspace/cancel',
    /** POST { id, password } → sets the panel (Plesk) password. */
    password: 'webspace/password',
    /** GET ?id= → { url } one-time panel login. */
    login: 'webspace/login',
    /** POST { id, package } → changes the package. */
    upgrade: 'webspace/upgrade',
  },
  server: {
    /** GET → KVM plans with prices. */
    plans: 'server/pricelist',
    /** GET → installable OS images. */
    images: 'server/images',
    /** POST { plan, image, hostname, password, tos: true } → { id, ip, ... } */
    order: 'server/order',
    /** GET ?id= → { id, status, ip, hostname, power } */
    single: 'server/single',
    all: 'server/all',
    /** POST { id, action: start | stop | shutdown | restart } */
    power: 'server/power',
    /** POST { id, image, password } */
    reinstall: 'server/reinstall',
    /** POST { id, password } → root password reset. */
    password: 'server/password',
    cancel: 'server/cancel',
    /** POST { id, plan } */
    upgrade: 'server/upgrade',
  },
} as const;
