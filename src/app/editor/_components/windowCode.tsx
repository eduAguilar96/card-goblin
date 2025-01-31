import { useState } from "react";
import Editor from "@monaco-editor/react";

export default function WindowCode() {
  const [code, setCode] = useState("// Start coding here\n");

  return (
    <div className="h-full w-full bg-gray-900 text-white">
      <Editor
        height="100%"
        defaultLanguage="javascript"
        theme="vs-dark"
        value={code}
        onChange={(value) => setCode(value || "")}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          automaticLayout: true,
        }}
      />
    </div>
  );
}
