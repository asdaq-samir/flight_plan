/**
 * The pages App Store Connect's URLs point at (Apple's Review Guidelines
 * 1.5 and 5.1.1(i)): plain HTML in public/, so they open without the
 * app's JavaScript, and under /app/ because that is where the web
 * server serves the build. Settings and the sign-in dialog link them
 * from this one list.
 */
export const LEGAL_PAGES = [
  { key: "privacy", title: "Privacy policy", href: "/app/privacy.html" },
  { key: "terms", title: "Terms of use", href: "/app/terms.html" },
  { key: "support", title: "Support", href: "/app/support.html" },
] as const;
