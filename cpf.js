import ExcelJS from "exceljs";

async function getWorksheet() {
    const fileSheet = new ExcelJS.Workbook();
    await fileSheet.xlsx.readFile("BUI_salarios_abaixo_3205.xlsx");
    const sheet = fileSheet.getWorksheet("QUE NÃO TEM");
    console.log(sheet.getCell("B2").value);
}

await getWorksheet()