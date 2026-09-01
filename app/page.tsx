import type { Metadata, Viewport } from "next";
import VantageLanding from "@/components/VantageLanding";

export const metadata: Metadata = {
  // Absolute: the landing must render the exact document title.
  title: { absolute: "Stop Guessing What They're Building" },
  description:
    "Drop in a competitor URL. An agent browses their site and the open web, then writes a structured teardown — and you watch it work.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function Home() {
  return <VantageLanding />;
}
