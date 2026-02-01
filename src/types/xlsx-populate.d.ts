declare module 'xlsx-populate' {
  interface Cell {
    value(): any;
    value(val: any): Cell;
  }

  interface Sheet {
    cell(address: string): Cell;
    name(): string;
  }

  interface Workbook {
    sheet(index: number): Sheet;
    sheet(name: string): Sheet;
    outputAsync(): Promise<Buffer>;
  }

  function fromDataAsync(data: Buffer | ArrayBuffer): Promise<Workbook>;
  function fromFileAsync(path: string): Promise<Workbook>;

  export default {
    fromDataAsync,
    fromFileAsync,
  };
}
