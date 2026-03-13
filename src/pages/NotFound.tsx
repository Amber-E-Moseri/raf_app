import { Link } from "react-router-dom";

import { PageShell } from "../components/layout/PageShell";
import { EmptyState } from "../components/ui/EmptyState";

export function NotFound() {
  return (
    <PageShell
      eyebrow="Routing"
      title="Page not found"
      description="The route does not exist in the RAF frontend."
      actions={<Link className="text-sm font-semibold text-raf-moss" to="/dashboard">Back to Dashboard</Link>}
    >
      <EmptyState
        title="Nothing here"
        message="Use the navigation to return to a supported section of the application."
      />
    </PageShell>
  );
}
