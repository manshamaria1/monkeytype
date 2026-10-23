import { Link } from "react-router-dom";

/** Shown instead of server-backed pages in the preview build. */
export default function PreviewOnly({ feature }: { feature: string }) {
  return (
    <div className="page">
      <div className="empty">
        <h1>{feature}</h1>
        <p>{feature} needs the full app running on a server, so it is not available in this preview.</p>
        <p className="muted">In this preview you can try typing tests, settings, themes and practice lessons. Your results stay in this browser.</p>
        <p>
          <Link className="btn" to="/">
            take a typing test
          </Link>
        </p>
      </div>
    </div>
  );
}
