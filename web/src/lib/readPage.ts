/**
 * The words on a photo of a page, read on the phone itself by Tesseract
 * (tesseract.js), at the owner's "Isn't there a library we can use?": no
 * key, no account and no server, and it works with no connection once its
 * files are kept. The library, its engine and its English are loaded only
 * at the first read, from this app's own origin (vite.config's
 * tesseractFiles), not a CDN: the page's Content-Security-Policy allows
 * scripts from itself alone (SecurityConfig).
 */
const BASE = `${import.meta.env.BASE_URL}tesseract/`;

export async function readPage(image: Blob): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: `${BASE}worker.min.js`,
    corePath: BASE,
    langPath: BASE,
    // The worker from its own file, not a blob: address the policy would refuse.
    workerBlobURL: false,
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    void worker.terminate();
  }
}
