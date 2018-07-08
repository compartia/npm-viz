import * as _ from 'lodash';


export function allSplits(str: string, delimiters: string): string[] {
    let splits = [];

    for (const splitter of delimiters) {
        let chunks = str.split(splitter);
        if (chunks.length > 1) {
            splits.push(chunks[0]);
            splits = splits.concat(chunks);
        }
    }
    // for (let i = 0; i < delimiters.length; i++) {
    //     let splitter = delimiters.charAt(i);
    //     let chunks = str.split(splitter);
    //     if (chunks.length > 1) {
    //         splits = splits.concat(chunks);
    //     }
    // }

    return splits;
}

export function countWords(words: string[], count: { [key: string]: number }) {
    for (const wrd of words) {
        if (isNaN(count[wrd])) {
            count[wrd] = 1;
        } else {
            count[wrd]++;
        }
    }
}