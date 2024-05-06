import type {BrowserWindow} from 'electron';
import {app} from 'electron';
import * as path from 'path';
import createQueue from '@libs/Queue/Queue';
import ELECTRON_EVENTS from './ELECTRON_EVENTS';
import type {Options} from './electronDownloadManagerType';

type DownloadItem = {
    // The window where the download will be initiated
    win: BrowserWindow;

    // The URL of the file to be downloaded
    url: string;

    // The options for the download, such as save path, file name, etc.
    options: Options;
};

/**
 * Returns the filename with extension based on the given name and MIME type.
 * @param name - The name of the file.
 * @param mime - The MIME type of the file.
 * @returns The filename with extension.
 */
const getFilenameFromMime = (name: string, mime: string): string => {
    const extensions = mime.split('/').pop();
    return `${name}.${extensions}`;
};

const createDownloadQueue = () => {
    const downloadItemProcessor = (item: DownloadItem): Promise<void> =>
        new Promise((resolve, reject) => {
            item.win.webContents.downloadURL(item.url);

            const listener = (event: Electron.Event, electronDownloadItem: Electron.DownloadItem) => {
                const options = item.options;
                const cleanup = () => item.win.webContents.session.removeListener('will-download', listener);
                const errorMessage = `The download of ${electronDownloadItem.getFilename()} was interrupted`;

                if (options.directory && !path.isAbsolute(options.directory)) {
                    throw new Error('The `directory` option must be an absolute path');
                }

                const directory = options.directory ?? app.getPath('downloads');

                let filePath: string;
                if (options.filename) {
                    filePath = path.join(directory, options.filename);
                } else {
                    const filename = electronDownloadItem.getFilename();
                    const name = path.extname(filename) ? filename : getFilenameFromMime(filename, electronDownloadItem.getMimeType());

                    filePath = options.overwrite ? path.join(directory, name) : path.join(directory, name);
                }

                if (options.saveAs) {
                    electronDownloadItem.setSaveDialogOptions({defaultPath: filePath, ...options.dialogOptions});
                } else {
                    electronDownloadItem.setSavePath(filePath);
                }

                electronDownloadItem.on('updated', (_, state) => {
                    if (state !== 'interrupted') {
                        return;
                    }

                    cleanup();
                    reject(new Error(errorMessage));
                    electronDownloadItem.cancel();
                });

                electronDownloadItem.on('done', (_, state) => {
                    cleanup();
                    if (state === 'cancelled') {
                        resolve();
                    } else if (state === 'interrupted') {
                        reject(new Error(errorMessage));
                    } else if (state === 'completed') {
                        if (process.platform === 'darwin') {
                            const savePath = electronDownloadItem.getSavePath();
                            app.dock.downloadFinished(savePath);
                        }
                        resolve();
                    }
                });

                item.win.webContents.send(ELECTRON_EVENTS.DOWNLOAD_STARTED, {url: item.url});
            };

            item.win.webContents.session.on('will-download', listener);
        });

    const queue = createQueue<DownloadItem>(downloadItemProcessor);

    const enqueueDownloadItem = (item: DownloadItem): void => {
        queue.enqueue(item);
    };
    return {enqueueDownloadItem, dequeueDownloadItem: queue.dequeue};
};

export default createDownloadQueue;
