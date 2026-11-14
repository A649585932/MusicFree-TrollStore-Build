#import "AppDelegate.h"
#import "CarPlaySceneDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <CarPlay/CarPlay.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"MusicFree";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  // RCTAppDelegate 在这里用 legacy 方式建 window（v17 能正常显示的路径）。
  // Info.plist 不声明 UIApplicationSceneManifest，主 App 不走 UIScene 生命周期。
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@".expo/.virtual-metro-entry"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

#pragma mark - CarPlay scene (no SceneManifest in Info.plist)

/*
 * 关键：Info.plist 里**不声明** UIApplicationSceneManifest。
 *
 * 原因（真机日志确认）：RN 0.76 + Expo 52 是纯 legacy AppDelegate，
 * 没有任何 UIWindowSceneDelegate 实现。声明 SceneManifest 后系统改用
 * UIScene 生命周期，RN 的 window 挂不上 -> 手机主 App 黑屏
 * （进程活着、scene ready、网络在跑，就是屏幕没内容，非崩溃）。
 *
 * CarPlay 的做法：连接车机时系统请求
 * CPTemplateApplicationSceneSessionRoleApplication 场景。
 * plist 里没有该配置时，UIKit 会回调本方法（Apple 文档明确此 delegate
 * 用于 "a configuration that isn't in your app's Info.plist"），
 * 由代码返回 CarPlay 配置即可，不需要 SceneManifest。
 *
 * 主 UIWindowScene 永远走系统默认的 legacy 路径，返回 nil 让系统处理，
 * 绝不自定义，保住主 App 正常显示。
 */
- (UISceneConfiguration *)application:(UIApplication *)application
    configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession
                                   options:(UISceneConnectionOptions *)options API_AVAILABLE(ios(13.0))
{
  if ([connectingSceneSession.role isEqualToString:CPTemplateApplicationSceneSessionRoleApplication]) {
    NSLog(@"[MusicFree][CarPlay] scene config requested");
    UISceneConfiguration *config = [[UISceneConfiguration alloc]
        initWithName:@"CarPlay"
        sessionRole:connectingSceneSession.role];
    config.delegateClass = [MFCarPlaySceneDelegate class];
    return config;
  }
  // 主场景：不碰，交给系统默认（legacy 路径）
  return nil;
}

@end
