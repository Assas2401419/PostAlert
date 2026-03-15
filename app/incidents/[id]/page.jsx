import { PlatformShell } from '../../../components/platform-shell.jsx';

export default async function IncidentPage({ params }) {
  const { id } = await params;

  return <PlatformShell incidentId={id} page="incident" />;
}
