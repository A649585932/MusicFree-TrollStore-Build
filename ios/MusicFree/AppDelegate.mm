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

#pragma mark - UISceneSession Lifecycle (CarPlay)

/*
 * 只给 CarPlay 场景返回自定义配置。
 * 主 App 的 window 仍由 RCTAppDelegate 在 didFinishLaunching 里
 * 用 legacy 路径创建（loadReactNativeWindow），这里对普通
 * UIWindowScene 返回系统默认配置，避免 RN 起两份/黑屏。
 *
 * Expo 的 ExpoAppDelegate.swift 明确没有实现
 * configurationForConnectingSceneSession（TODO 注释），
 * 且 EXAppDelegateWrapper 子类方法优先于转发，所以本方法会生效。
 */
- (UISceneConfiguration *)application:(UIApplication *)application
    configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession
                                   options:(UISceneConnectionOptions *)options API_AVAILABLE(ios(13.0))
{
  if ([connectingSceneSession.role isEqualToString:CPTemplateApplicationSceneSessionRoleApplication]) {
    UISceneConfiguration *config = [[UISceneConfiguration alloc]
        initWithName:@"CarPlay"
        sessionRole:connectingSceneSession.role];
    config.delegateClass = [MFCarPlaySceneDelegate class];
    return config;
  }
  // 主界面：让系统/RN 走原来的 window 路径
  return [[UISceneConfiguration alloc]
      initWithName:@"Default Configuration"
      sessionRole:connectingSceneSession.role];
}

@end
