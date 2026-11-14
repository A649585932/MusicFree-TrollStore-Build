//
//  CarPlayBridge.h
//  Phase 1: RN <-> CarPlay 双向桥
//
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

/**
 * 车机 -> JS 事件通过 NSNotificationCenter 发到本类，再 sendEvent 给 RN。
 * JS -> 车机 数据（歌单/曲目/播放状态）通过 exported methods 传入，
 * 存到静态单例，CarPlaySceneDelegate 读取后刷新模板。
 */
@interface MFCarPlayBridge : RCTEventEmitter <RCTBridgeModule>

/** 单例，供 CarPlaySceneDelegate 读取 JS 推来的数据 */
+ (instancetype)shared;

/** JS 推送歌单列表：@[{id, title, count}] */
- (void)setSheets:(NSArray *)sheets;
/** JS 推送某歌单的曲目：@[{id, title, artist}] */
- (void)setTracks:(NSArray *)tracks forSheetId:(NSString *)sheetId;
/** JS 推送正在播放信息 */
- (void)setNowPlayingTitle:(NSString *)title artist:(NSString *)artist;

/** 车机侧读取 */
- (NSArray *)sheets;
- (NSArray *)tracksForSheetId:(NSString *)sheetId;
- (NSDictionary *)nowPlaying;

/** 车机点击某首曲目 -> 通知 JS */
+ (void)emitPlayTrack:(NSString *)trackId sheetId:(NSString *)sheetId;
/** 车机点某个歌单 -> 请求 JS 推该歌单曲目 */
+ (void)emitRequestTracks:(NSString *)sheetId;
/** 车机播放控制 */
+ (void)emitControl:(NSString *)action;

@end
