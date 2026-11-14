/*
 * CarPlaySceneDelegate.m — Phase 0 minimal probe
 *
 * 目标：验证 TrollStore 伪签名 + com.apple.developer.carplay-audio
 *      在 iOS 16.1.1 真机上能不能让车机出现本 App。
 * 因此这里只做一个静态列表 + NowPlaying 模板，不接 RN/播放器。
 */
#import "CarPlaySceneDelegate.h"

@implementation MFCarPlaySceneDelegate

#pragma mark - CPTemplateApplicationSceneDelegate

- (void)templateApplicationScene:(CPTemplateApplicationScene *)templateApplicationScene
    didConnectInterfaceController:(CPInterfaceController *)interfaceController
{
    self.interfaceController = interfaceController;
    NSLog(@"[MusicFree][CarPlay] connected");

    // 根模板：一个静态列表（Phase 0 只验证界面能出来）
    CPListItem *item = [[CPListItem alloc] initWithText:@"MusicFree"
                                             detailText:@"CarPlay 已连接"
                                                  image:nil
                                          accessoryType:CPListItemAccessoryTypeNone];
    CPListSection *section = [[CPListSection alloc] initWithItems:@[item]];
    CPListTemplate *list = [[CPListTemplate alloc] initWithTitle:@"MusicFree"
                                                        sections:@[section]];
    list.tabTitle = @"MusicFree";
    list.tabImage = nil;

    // 正在播放模板（系统自带播放控制）
    CPNowPlayingTemplate *nowPlaying = [CPNowPlayingTemplate sharedTemplate];

    [interfaceController setRootTemplate:list animated:YES completion:nil];
    // 让 NowPlaying 出现在 tab 上；Phase 1 会把真实歌单/播放状态推上来
    [interfaceController pushTemplate:nowPlaying animated:NO completion:nil];
}

- (void)templateApplicationScene:(CPTemplateApplicationScene *)templateApplicationScene
    didDisconnectInterfaceController:(CPInterfaceController *)interfaceController
{
    self.interfaceController = nil;
    NSLog(@"[MusicFree][CarPlay] disconnected");
}

@end
