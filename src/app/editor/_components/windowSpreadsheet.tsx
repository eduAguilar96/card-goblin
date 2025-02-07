import { useState } from "react";
import Spreadsheet from "react-spreadsheet";

export default function WindowSpreadsheet() {
  const [numRows, setNumRows] = useState(2);
  const [rowLabels, setRowLabels] = useState(["Card 1", "Card 2"]);
  const [numCols, setNumCols] = useState(2);
  const [columnLabels, setColumnLabels] = useState(["Name", "Suit"]);
  const [data, setData] = useState([
    [{ value: "Vanilla" }, { value: "Chocolate" }],
    [{ value: "Strawberry" }, { value: "Cookies" }],
  ]);

  const addColumn = () => {
    const newNumCols = numCols + 1;
    setNumCols(newNumCols);
    const newData = data.map((row) => [...row, { value: "" }]);
    setData(newData);
    setColumnLabels([...columnLabels, `Column ${newNumCols}`]);
  };

  const addRow = () => {
    const newNumRows = numRows + 1;
    setNumRows(newNumRows);
    const newRow = Array(numCols).fill({ value: "" });
    setData([...data, newRow]);
    setRowLabels([...rowLabels, `Card ${newNumRows}`]);
  };

  return (
    // Full-screen container that scrolls when its inner content grows larger than the viewport.
    <div className="w-screen h-screen overflow-auto p-4 bg-gray-900">
      {/* The inline-block container will expand with its content (the spreadsheet and buttons) */}
      <div className="inline-block">
        {/* Row containing the spreadsheet (on the left) and the add‑column button (to its right) */}
        <div className="flex items-start">
          <div className="inline-block">
            <Spreadsheet
              data={data}
              columnLabels={columnLabels}
              rowLabels={rowLabels}
            />
          </div>
          <button
            onClick={addColumn}
            className="w-10 h-10 ml-4 flex items-center justify-center bg-gray-700 text-white rounded-full hover:bg-gray-600"
          >
            +
          </button>
        </div>
        {/* Add‑row button placed below the spreadsheet */}
        <div className="mt-4">
          <button
            onClick={addRow}
            className="w-10 h-10 flex items-center justify-center bg-gray-700 text-white rounded-full hover:bg-gray-600"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
