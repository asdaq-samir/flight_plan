/**
 * The API docs links, formerly their own Playground panel -- moved
 * here so they're reachable from every "document" page (Home,
 * Playground, Account) instead of buried one collapsed section deep
 * on just one of them. Not rendered on Plan/Label: those are
 * deliberately edge-to-edge, no-scroll map apps (Shell.tsx's own
 * doc comment), and a footer has nowhere to sit there without either
 * becoming another floating overlay or shrinking the map further on
 * top of the header already doing so.
 */
export default function Footer() {
  const host = window.location.hostname;
  // planning-service/model-service publish no port on AWS -- planning-service
  // sits behind webapp in a private subnet, model-service becomes a
  // SageMaker endpoint (see docs/README.md's own architecture) -- so a
  // direct :8084/:8000 link is only ever reachable against a local
  // docker-compose stack. Gated rather than removed, since it's a real
  // convenience there.
  const isLocalDev = host === "localhost" || host === "127.0.0.1";
  return (
    <footer className="border-t border-slate-200 px-4 py-4 text-xs text-slate-400">
      <span className="mr-3">API docs:</span>
      <a href="/swagger-ui.html" className="mr-3 text-blue-600 underline">webapp</a>
      {isLocalDev && (
        <>
          <a href={`http://${host}:8084/docs`} className="mr-3 text-blue-600 underline">planning-service</a>
          <a href={`http://${host}:8000/docs`} className="text-blue-600 underline">model-service</a>
        </>
      )}
    </footer>
  );
}
