"use client";

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import WindowCode from "@/app/editor/_components/windowCode";
import WindowPreview from "@/app/editor/_components/windowPreview";
import WindowSpredsheet from "@/app/editor/_components/windowSpredsheet";

export default function PanelLayout() {
  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Main Split Panel */}
      <PanelGroup direction="vertical" className="h-full w-full">
        <Panel className="flex-grow" defaultSize={70}>
          <PanelGroup direction="horizontal">
            {/* Code Editor */}
            <Panel
              className="p-4 bg-gray-800 border-r border-gray-700"
              defaultSize={50}
            >
              <WindowCode />
            </Panel>
            <PanelResizeHandle className="w-2 bg-gray-600 hover:bg-gray-500 cursor-col-resize" />
            {/* Card Preview */}
            <Panel
              className="p-4 flex justify-center items-center bg-gray-900"
              defaultSize={50}
            >
              <WindowPreview />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="h-2 bg-gray-600 hover:bg-gray-500 cursor-row-resize" />
        {/* CSV Editor */}
        <Panel
          className="p-4 bg-gray-800 border-t border-gray-700"
          defaultSize={30}
        >
          <WindowSpredsheet />
        </Panel>
      </PanelGroup>
    </div>
  );
}
