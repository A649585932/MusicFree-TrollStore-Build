/*
 * CarPlaySceneDelegate.m — Phase 1
 *
 * 只用 iOS 14+ 稳定 API，规避 SDK 签名差异（之前 initWithText:detailText:image:accessoryType
 * 编译失败就是教训）。点击处理用 CPListItem.handler（block），不用
 * CPListTemplateDelegate（该协议方法签名在不同 SDK 上有差异）。
 */
#import "CarPlaySceneDelegate.h"
#import "CarPlayBridge.h"

@implementation MFCarPlaySceneDelegate {
    CPListTemplate *_rootList;
    NSString *_currentSheetId;
    NSString *_currentSheetTitle;
}

#pragma mark - CPTemplateApplicationSceneDelegate

- (void)templateApplicationScene:(CPTemplateApplicationScene *)templateApplicationScene
    didConnectInterfaceController:(CPInterfaceController *)interfaceController
{
    self.interfaceController = interfaceController;
    NSLog(@"[MusicFree][CarPlay] connected (phase1)");

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(dataDidUpdate:)
                                                 name:@"MFCarPlayDataDidUpdate"
                                               object:nil];

    [self rebuildRoot];
    [MFCarPlayBridge emitControl:@"requestSheets"];
}

- (void)templateApplicationScene:(CPTemplateApplicationScene *)templateApplicationScene
    didDisconnectInterfaceController:(CPInterfaceController *)interfaceController
{
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    self.interfaceController = nil;
    NSLog(@"[MusicFree][CarPlay] disconnected");
}

#pragma mark - 数据读取

- (NSArray<NSDictionary *> *)sheets {
    MFCarPlayBridge *bridge = [MFCarPlayBridge shared];
    NSArray *s = [bridge sheets];
    return [s isKindOfClass:[NSArray class]] ? s : @[];
}

- (NSArray<NSDictionary *> *)tracksForSheet:(NSString *)sheetId {
    MFCarPlayBridge *bridge = [MFCarPlayBridge shared];
    NSArray *t = [bridge tracksForSheetId:sheetId];
    return [t isKindOfClass:[NSArray class]] ? t : @[];
}

#pragma mark - 模板构建

- (void)rebuildRoot {
    NSArray *sheetItems = [self sheets];
    NSMutableArray<CPListItem *> *items = [NSMutableArray array];

    if (sheetItems.count == 0) {
        [items addObject:[[CPListItem alloc] initWithText:@"暂无歌单"
                                               detailText:@"请在手机 App 中导入或创建歌单"]];
    } else {
        __weak __typeof(self) weakSelf = self;
        for (NSDictionary *s in sheetItems) {
            NSString *sid = [s[@"id"] isKindOfClass:[NSString class]] ? s[@"id"] : @"";
            NSString *title = [s[@"title"] isKindOfClass:[NSString class]] ? s[@"title"] : @"未命名歌单";
            id count = s[@"count"];
            NSString *detail = [count isKindOfClass:[NSNumber class]]
                ? [NSString stringWithFormat:@"%@ 首", count]
                : @"";
            CPListItem *item = [[CPListItem alloc] initWithText:title detailText:detail];
            item.accessoryType = CPListItemAccessoryTypeDisclosureIndicator;
            // handler 是 CPListItem 的稳定属性（iOS 14+），点击触发
            item.handler = ^(CPListItem * _Nonnull selectedItem, dispatch_block_t completion) {
                __strong __typeof(weakSelf) self = weakSelf;
                if (self) {
                    [self pushTracksForSheet:sid title:title];
                }
                completion();
            };
            [items addObject:item];
        }
    }

    CPListSection *section = [[CPListSection alloc] initWithItems:items];
    CPListTemplate *list = [[CPListTemplate alloc] initWithTitle:@"音乐"
                                                        sections:@[section]];
    _rootList = list;
    [self.interfaceController setRootTemplate:list animated:YES completion:nil];
}

- (void)pushTracksForSheet:(NSString *)sheetId title:(NSString *)title {
    _currentSheetId = sheetId;
    _currentSheetTitle = title;
    NSArray *tracks = [self tracksForSheet:sheetId];
    NSMutableArray<CPListItem *> *items = [NSMutableArray array];
    if (tracks.count == 0) {
        [items addObject:[[CPListItem alloc] initWithText:@"加载中…" detailText:@""]];
    } else {
        items = [[self buildTrackItems:tracks sheetId:sheetId] mutableCopy];
    }
    CPListSection *section = [[CPListSection alloc] initWithItems:items];
    CPListTemplate *tl = [[CPListTemplate alloc] initWithTitle:title ?: @"歌单"
                                                      sections:@[section]];
    [self.interfaceController pushTemplate:tl animated:YES completion:nil];
    [MFCarPlayBridge emitRequestTracks:sheetId];
}

- (NSArray<CPListItem *> *)buildTrackItems:(NSArray<NSDictionary *> *)tracks
                                   sheetId:(NSString *)sheetId
{
    NSMutableArray<CPListItem *> *items = [NSMutableArray array];
    for (NSDictionary *t in tracks) {
        NSString *tid = [t[@"id"] isKindOfClass:[NSString class]] ? t[@"id"] : @"";
        NSString *tname = [t[@"title"] isKindOfClass:[NSString class]] ? t[@"title"] : @"未知歌曲";
        NSString *artist = [t[@"artist"] isKindOfClass:[NSString class]] ? t[@"artist"] : @"";
        CPListItem *item = [[CPListItem alloc] initWithText:tname detailText:artist];
        __weak __typeof(self) weakSelf = self;
        item.handler = ^(CPListItem * _Nonnull selectedItem, dispatch_block_t completion) {
            __strong __typeof(weakSelf) self = weakSelf;
            if (self) {
                NSLog(@"[MusicFree][CarPlay] play track %@ in sheet %@", tid, sheetId);
                [MFCarPlayBridge emitPlayTrack:tid sheetId:sheetId];
            }
            completion();
        };
        [items addObject:item];
    }
    return items;
}

- (void)refreshVisibleTracks {
    if (!_currentSheetId || !self.interfaceController || !self.interfaceController.topTemplate) {
        return;
    }
    CPTemplate *top = self.interfaceController.topTemplate;
    if (![top isKindOfClass:[CPListTemplate class]] || top == _rootList) {
        return;
    }
    NSArray *tracks = [self tracksForSheet:_currentSheetId];
    NSArray<CPListItem *> *items = [self buildTrackItems:tracks sheetId:_currentSheetId];
    if (items.count == 0) {
        items = @[[[CPListItem alloc] initWithText:@"暂无歌曲" detailText:@""]];
    }
    [(CPListTemplate *)top updateSections:@[[[CPListSection alloc] initWithItems:items]]];
}

#pragma mark - 数据更新通知

- (void)dataDidUpdate:(NSNotification *)note {
    NSString *kind = note.userInfo[@"kind"];
    NSString *sheetId = note.userInfo[@"sheetId"];
    if ([kind isEqualToString:@"sheets"]) {
        [self rebuildRoot];
    } else if ([kind isEqualToString:@"tracks"]) {
        if (!sheetId || [sheetId isEqualToString:_currentSheetId]) {
            [self refreshVisibleTracks];
        }
    }
}

@end
