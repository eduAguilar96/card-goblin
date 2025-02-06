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
    const newData = data.map((row) => {
      const newRow = [...row];
      newRow.push({ value: "" });
      return newRow;
    });
    const newColLabel = `Column ${newNumCols}`;
    setColumnLabels([...columnLabels, newColLabel]);
    setData(newData);
  };

  const addRow = () => {
    // Logic to add a row
    const newNumRows = numRows + 1;
    setNumRows(newNumRows);
    const newRow = Array(numCols).fill({ value: "" });
    const newData = [...data, newRow];
    const newRowLabel = `Card ${newNumRows}`;
    setRowLabels([...rowLabels, newRowLabel]);
    setData(newData);
  };
  return (
    <div className="relative">
      <Spreadsheet
        data={data}
        columnLabels={columnLabels}
        rowLabels={rowLabels}
      />
      <button
        className="absolute top-0 right-0 m-2 p-2 bg-blue-500 text-white rounded"
        onClick={addColumn}
      >
        +
      </button>
      <button
        className="absolute bottom-0 left-0 m-2 p-2 bg-green-500 text-white rounded"
        onClick={addRow}
      >
        +
      </button>
    </div>
  );
}
