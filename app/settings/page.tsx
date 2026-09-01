import type { Metadata } from "next";
import AppChrome from "@/components/AppChrome";
import SettingsForm from "@/components/SettingsForm";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <AppChrome>
      <SettingsForm />
    </AppChrome>
  );
}
