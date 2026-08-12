"use client";

import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import StatusBar from "@/app/editor/_components/statusBar";
import WindowCode from "@/app/editor/_components/windowCode";
import WindowPreview from "@/app/editor/_components/windowPreview";
import WindowSpreadsheet from "@/app/editor/_components/windowSpreadsheet";
import { initEditorPersistence } from "@/app/editor/_store/persistence";
import { initAssetStore } from "@/app/editor/_store/assetStore";

export default function PanelLayout() {
  // Autosave restore + subscription, POST-hydration (§6.2): the prerender and
  // the hydration pass show the demo; restoring any earlier would mismatch
  // them. Idempotent, so StrictMode's double effect run is harmless.
  useEffect(() => {
    initEditorPersistence();
    // §7.1b: attaches the real IndexedDB-backed asset store — SSR-safe/no-op
    // without `window` for the same reason, and idempotent for the same
    // StrictMode double-mount.
    initAssetStore();
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Main Split Panel */}
      <div className="min-h-0 flex-1">
        <PanelGroup direction="vertical" className="h-full w-full">
          <Panel className="flex-grow" defaultSize={70}>
            <PanelGroup direction="horizontal">
              {/* Code Editor */}
              <Panel
                className="bg-gray-800 border-r border-gray-700"
                defaultSize={50}
              >
                <WindowCode />
              </Panel>
              <PanelResizeHandle className="w-2 bg-gray-600 hover:bg-gray-500 cursor-col-resize" />
              {/* Card Preview */}
              <Panel
                className="flex justify-center items-center bg-gray-900"
                defaultSize={50}
              >
                <WindowPreview />
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="h-2 bg-gray-600 hover:bg-gray-500 cursor-row-resize" />
          {/* CSV Editor */}
          <Panel defaultSize={30}>
            <WindowSpreadsheet />
          </Panel>
        </PanelGroup>
      </div>
      {/* Unified status bar (task 7): one line across the whole editor. */}
      <StatusBar />
    </div>
  );
}
