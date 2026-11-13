/**
 * iOS / TrollStore 版 Mp3Util
 *
 * 原工程只有 Android 的 MP3 ID3 标签读取/写入原生实现。
 * iOS 上返回安全空值即可：所有调用点都用了可选链或 try/catch 兜底
 * （localMusicSheet.ts 用 meta?.title，plugin.ts 用 try/catch 与空字符串），
 * 因此降级后"导入本地音乐 / 读取内嵌封面与歌词"仍能工作，
 * 只是拿不到 ID3 元数据，标题会回退到文件名、封面回退为空。
 *
 * 若以后要完整支持，可用 ffmpeg-kit 或 AVAsset / ID3 解析写 iOS 原生模块。
 */
export interface IBasicMeta {
    album?: string;
    artist?: string;
    author?: string;
    duration?: string;
    title?: string;
}

export interface IWritableMeta extends IBasicMeta {
    lyric?: string;
    comment?: string;
}

export interface IMp3Util {
    getBasicMeta: (fileName: string) => Promise<IBasicMeta>;
    getMediaMeta: (fileNames: string[]) => Promise<IBasicMeta[]>;
    getMediaCoverImg: (mediaPath: string) => Promise<string>;
    getLyric: (mediaPath: string) => Promise<string>;
    setMediaTag: (filePath: string, meta: IWritableMeta) => Promise<void>;
    getMediaTag: (filePath: string) => Promise<IWritableMeta>;
}

const Mp3Util: IMp3Util = {
    getBasicMeta: async () => ({}),

    /** 长度必须与入参一致，localMusicSheet.ts 用 metas[index] 对齐 musicList */
    getMediaMeta: async (fileNames: string[]) => fileNames.map(() => ({})),

    /** 返回空串，plugin.ts 的 getMusicInfo 会把它当作 artwork: "" */
    getMediaCoverImg: async () => "",

    /** 返回空串（falsy），plugin.ts 会继续尝试同名 .lrc 文件 */
    getLyric: async () => "",

    setMediaTag: async () => {},

    getMediaTag: async () => ({}),
};

export default Mp3Util;
