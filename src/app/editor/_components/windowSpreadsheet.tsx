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
    // This container fills its parent (the resizable panel) and scrolls if needed.
    <div className="w-full h-full overflow-auto p-4 bg-gray-800">
      <div className="flex flex-col">
        <div className="flex items-start">
          <Spreadsheet
            data={data}
            columnLabels={columnLabels}
            rowLabels={rowLabels}
          />
          {/* Wrap the button in its own container with right padding */}
          <div className="flex-shrink-0 ml-4 pr-4">
            <button
              onClick={addColumn}
              className="w-10 h-10 flex items-center justify-center bg-gray-700 text-white rounded-full hover:bg-gray-600"
            >
              +
            </button>
          </div>
        </div>
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
