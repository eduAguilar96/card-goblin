import { useState } from "react";
import DataGrid from "react-data-grid";

export default function WindowSpreadsheet() {
  const [rows, setRows] = useState(
    new Array(100).fill(null).map((_, index) => ({
      id: index + 1,
      name: "",
      cost: "",
      type: "",
    }))
  );

  const columns = [
    { key: "id", name: "ID", width: 50 },
    { key: "name", name: "Name", editable: true },
    { key: "cost", name: "Cost", editable: true },
    { key: "type", name: "Type", editable: true },
  ];

  return (
    <div className="h-full w-full bg-gray-800 p-2 overflow-auto">
      <div className="border border-gray-700 rounded-md shadow-lg">
        <DataGrid
          columns={columns}
          rows={rows}
          onRowsChange={setRows}
          style={{ height: "100%", width: "100%" }}
          rowHeight={30}
          className="rdg-dark"
        />
      </div>
    </div>
  );
}
