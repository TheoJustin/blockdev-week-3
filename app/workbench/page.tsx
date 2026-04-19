import { DemoShell } from "@/components/demo-shell";
import { addSections, architectureChoices, demoScenarios, presentationPhases, sampleSourceNotes } from "@/lib/demo-data";

export default function WorkbenchPage() {
  return (
    <DemoShell
      addSections={addSections}
      comparisonRows={architectureChoices}
      defaultSourceNotes={sampleSourceNotes}
      phases={presentationPhases}
      scenarios={demoScenarios}
    />
  );
}
