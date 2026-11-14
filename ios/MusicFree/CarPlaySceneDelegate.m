/*
 * CarPlaySceneDelegate.m — Phase 0 minimal probe
 *
 * 目标：验证 TrollStore 伪签名 + com.apple.developer.carplay-audio
 *      在 iOS 16.1.1 真机上能不能让车机出现本 App。
 * 只做一个静态列表，不接 RN/播放器。
 *
 * 注意：刻意只用 iOS 14+ 最基础、签名稳定的 CarPlay API，
 *      避免 SDK 版本差异导致的编译错误。
 */
#import "CarPlaySceneDelegate.h"

@implementation MFCarPlaySceneDelegate

#pragma mark - CPTemplateApplicationSceneDelegate

- (void)templateApplicationScene:(CPTemplateApplicationScene *)templateApplicationScene
    didConnectInterfaceController:(CPInterfaceController *)interfaceController
{
    self.interfaceController = interfaceController;
    NSLog(@"[MusicFree][CarPlay] connected");

    // CPListItem 基础初始化（iOS 14+，签名稳定）
    CPListItem *item = [[CPListItem alloc] initWithText:@"MusicFree"
                                             detailText:@"CarPlay 已连接"];
    CPListSection *section = [[CPListSection alloc] initWithItems:@[item]];
    CPListTemplate *list = [[CPListTemplate alloc] initWithTitle:@"MusicFree"
                                                        sections:@[section]];

    [interfaceController setRootTemplate:list
                                animated:YES
                              completion:^(BOOL done, NSError * _Nullable error) {
        NSLog(@"[MusicFree][CarPlay] rootTemplate set done=%d err=%@", done, error);
    }];
}

- (void)templateApplicationScene:(CPTemplateApplicationScene *)templateApplicationScene
    didDisconnectInterfaceController:(CPInterfaceController *)interfaceController
{
    self.interfaceController = nil;
    NSLog(@"[MusicFree][CarPlay] disconnected");
}

@end
