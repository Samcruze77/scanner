import { CampaignForm } from "../CampaignForm";

export default function NewCampaignPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">New campaign</h1>
      <CampaignForm />
    </div>
  );
}
