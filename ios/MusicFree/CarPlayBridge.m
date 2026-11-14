//
//  CarPlayBridge.m
//  Phase 1: RN <-> CarPlay 双向桥
//
#import "CarPlayBridge.h"
#import <React/RCTLog.h>

// 车机事件通过通知发到 bridge（bridge 是 RN module 实例，
// CarPlaySceneDelegate 不持有它，解耦两个场景的生命周期）
static NSString *const kMFCarPlayEventNotification = @"MFCarPlayEventNotification";

@interface MFCarPlayBridge ()
@property (nonatomic, strong) NSArray *sheetsData;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSArray *> *tracksData;
@property (nonatomic, strong) NSDictionary *nowPlayingData;
@property (nonatomic, assign) BOOL hasListeners;
@end

static MFCarPlayBridge *sharedInstance = nil;

@implementation MFCarPlayBridge

+ (instancetype)shared {
    return sharedInstance;
}

- (instancetype)init {
    if (self = [super init]) {
        _sheetsData = @[];
        _tracksData = [NSMutableDictionary dictionary];
        _nowPlayingData = @{};
        sharedInstance = self;
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleCarPlayEvent:)
                                                     name:kMFCarPlayEventNotification
                                                   object:nil];
    }
    return self;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    if (sharedInstance == self) {
        sharedInstance = nil;
    }
}

RCT_EXPORT_MODULE(CarPlayBridge);

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"CarPlayPlayTrack", @"CarPlayRequestTracks", @"CarPlayControl"];
}

- (void)startObserving {
    self.hasListeners = YES;
}

- (void)stopObserving {
    self.hasListeners = NO;
}

#pragma mark - JS -> 车机（数据）

RCT_EXPORT_METHOD(setSheets:(NSArray *)sheets)
{
    self.sheetsData = [sheets isKindOfClass:[NSArray class]] ? sheets : @[];
    // 通知车机刷新模板（主线程，UI 操作）
    dispatch_async(dispatch_get_main_queue(), ^{
        [[NSNotificationCenter defaultCenter] postNotificationName:@"MFCarPlayDataDidUpdate"
                                                            object:nil
                                                          userInfo:@{@"kind": @"sheets"}];
    });
}

RCT_EXPORT_METHOD(setTracks:(NSArray *)tracks forSheetId:(NSString *)sheetId)
{
    if (![sheetId isKindOfClass:[NSString class]]) {
        return;
    }
    self.tracksData[sheetId] = [tracks isKindOfClass:[NSArray class]] ? tracks : @[];
    dispatch_async(dispatch_get_main_queue(), ^{
        [[NSNotificationCenter defaultCenter] postNotificationName:@"MFCarPlayDataDidUpdate"
                                                            object:nil
                                                          userInfo:@{@"kind": @"tracks", @"sheetId": sheetId}];
    });
}

RCT_EXPORT_METHOD(setNowPlaying:(NSString *)title artist:(NSString *)artist)
{
    self.nowPlayingData = @{
        @"title": title ?: @"",
        @"artist": artist ?: @"",
    };
    dispatch_async(dispatch_get_main_queue(), ^{
        [[NSNotificationCenter defaultCenter] postNotificationName:@"MFCarPlayDataDidUpdate"
                                                            object:nil
                                                          userInfo:@{@"kind": @"nowPlaying"}];
    });
}

#pragma mark - 车机侧读取

- (NSArray *)sheets {
    return self.sheetsData ?: @[];
}

- (NSArray *)tracksForSheetId:(NSString *)sheetId {
    return self.tracksData[sheetId] ?: @[];
}

- (NSDictionary *)nowPlaying {
    return self.nowPlayingData ?: @{};
}

#pragma mark - 车机 -> JS（事件）

+ (void)postEvent:(NSString *)name body:(NSDictionary *)body {
    dispatch_async(dispatch_get_main_queue(), ^{
        [[NSNotificationCenter defaultCenter] postNotificationName:kMFCarPlayEventNotification
                                                            object:nil
                                                          userInfo:@{@"name": name, @"body": body ?: @{}}];
    });
}

+ (void)emitPlayTrack:(NSString *)trackId sheetId:(NSString *)sheetId {
    [self postEvent:@"CarPlayPlayTrack" body:@{@"trackId": trackId ?: @"", @"sheetId": sheetId ?: @""}];
}

+ (void)emitRequestTracks:(NSString *)sheetId {
    [self postEvent:@"CarPlayRequestTracks" body:@{@"sheetId": sheetId ?: @""}];
}

+ (void)emitControl:(NSString *)action {
    [self postEvent:@"CarPlayControl" body:@{@"action": action ?: @""}];
}

- (void)handleCarPlayEvent:(NSNotification *)note {
    NSString *name = note.userInfo[@"name"];
    NSDictionary *body = note.userInfo[@"body"];
    if (name && self.hasListeners) {
        [self sendEventWithName:name body:body];
    } else {
        RCTLogInfo(@"[MusicFree][CarPlay] event %@ dropped (listeners=%d)", name, self.hasListeners);
    }
}

@end
