/**
 * CarPlay JS 桥（Phase 1）
 *
 * 职责：
 *  - 车机连上 / 请求数据 -> 把歌单、曲目推给原生 CarPlayBridge
 *  - 车机点歌 -> 调 TrackPlayer 播放对应曲目（复用现有取链/会员歌修复）
 *  - 车机控制（播放/暂停/上一首/下一首）-> TrackPlayer
 *  - 播放状态变化 -> 推送 NowPlaying 给车机
 *
 * 通过 NativeModules.CarPlayBridge + NativeEventEmitter 双向通信。
 * iOS 无 CarPlay 模块时（安卓）所有调用静默降级为 no-op。
 */
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

import MusicSheet from "@/core/musicSheet";
import TrackPlayer from "@/core/trackPlayer";
import { errorLog, trace } from "@/utils/log";

const NativeBridge = NativeModules.CarPlayBridge;

/** 是否具备原生 CarPlay 桥 */
export const isCarPlayAvailable = Platform.OS === "ios" && !!NativeBridge;

let emitter: NativeEventEmitter | null = null;
let started = false;

function getEmitter(): NativeEventEmitter | null {
    if (!isCarPlayAvailable) {
        return null;
    }
    if (!emitter) {
        emitter = new NativeEventEmitter(NativeBridge);
    }
    return emitter;
}

/** 推送全部歌单 */
function pushSheets() {
    if (!NativeBridge?.setSheets) {
        return;
    }
    try {
        const sheets = MusicSheet.getAllSheetsForCarPlay();
        NativeBridge.setSheets(sheets);
        trace(`[CarPlay] push ${sheets.length} sheets`);
    } catch (e) {
        errorLog("[CarPlay] pushSheets", e);
    }
}

/** 推送某歌单曲目 */
function pushTracks(sheetId: string) {
    if (!NativeBridge?.setTracks || !sheetId) {
        return;
    }
    try {
        const tracks = MusicSheet.getTracksForCarPlay(sheetId);
        NativeBridge.setTracks(tracks, sheetId);
        trace(`[CarPlay] push ${tracks.length} tracks for ${sheetId}`);
    } catch (e) {
        errorLog("[CarPlay] pushTracks", e);
    }
}

/** 点歌：用 playWithReplacePlayList 播放整张歌单，从选中曲目开始 */
async function playTrack(trackId: string, sheetId: string) {
    try {
        const musicItem = MusicSheet.findMusicItemForCarPlay(sheetId, trackId);
        if (!musicItem) {
            errorLog("[CarPlay] track not found", { trackId, sheetId });
            return;
        }
        const list = MusicSheet.getSortedMusicListBySheetId(sheetId)?.musicList ?? [];
        if (!list.length) {
            return;
        }
        await TrackPlayer.playWithReplacePlayList(musicItem, [...list]);
        pushNowPlaying(musicItem);
    } catch (e) {
        errorLog("[CarPlay] playTrack", e);
    }
}

/** 推送正在播放 */
function pushNowPlaying(musicItem?: any) {
    if (!NativeBridge?.setNowPlaying) {
        return;
    }
    try {
        const title = musicItem?.title ?? "";
        const artist = musicItem?.artist ?? "";
        NativeBridge.setNowPlaying(title, artist);
    } catch (e) {
        errorLog("[CarPlay] pushNowPlaying", e);
    }
}

/** 车机控制指令 */
async function handleControl(action: string) {
    try {
        switch (action) {
            case "requestSheets":
                pushSheets();
                break;
            case "play":
                await TrackPlayer.play();
                break;
            case "pause":
                await TrackPlayer.pause();
                break;
            case "next":
                await TrackPlayer.skipToNext();
                break;
            case "prev":
                await TrackPlayer.skipToPrevious();
                break;
            default:
                break;
        }
    } catch (e) {
        errorLog("[CarPlay] handleControl", e);
    }
}

/**
 * 启动时调用一次（bootstrap 里），注册所有监听。
 * 幂等：重复调用不会重复注册。
 */
export function setupCarPlay() {
    if (started || !isCarPlayAvailable) {
        return;
    }
    started = true;

    const em = getEmitter();
    if (!em) {
        return;
    }

    em.addListener("CarPlayRequestTracks", (e: { sheetId?: string }) => {
        if (e?.sheetId) {
            pushTracks(e.sheetId);
        }
    });

    em.addListener("CarPlayPlayTrack", (e: { trackId?: string; sheetId?: string }) => {
        if (e?.trackId && e?.sheetId) {
            playTrack(e.trackId, e.sheetId);
        }
    });

    em.addListener("CarPlayControl", (e: { action?: string }) => {
        if (e?.action) {
            handleControl(e.action);
        }
    });

    // 连接时车机会主动发 requestSheets；这里也先推一次，覆盖冷启动时序
    pushSheets();
    trace("[CarPlay] JS bridge started");
}

export default {
    setupCarPlay,
    isCarPlayAvailable,
    pushSheets,
    pushTracks,
    pushNowPlaying,
};
