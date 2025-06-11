import { FileLineReader } from "./file_line_reader";


class Loader {
    constructor() {
    }

    load(reader: FileLineReader, finishCallback: any, 
        progressCallback: any, errorCallback: any
    ) {
        reader.readLinesWithCallback((line: string) => {
            // progressCallback(line);
        });
    }
};

export { Loader };
