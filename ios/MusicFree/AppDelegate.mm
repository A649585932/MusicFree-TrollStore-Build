#import "AppDelegate.h"
#import "CarPlaySceneDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <CarPlay/CarPlay.h>

// RCTAppDelegate 的 loadReactNativeWindow: 未在公开头文件暴露，
// 声明一下备用（仅在 window 尚未建立且 rootViewFactory 就绪时使用）。
@interface RCTAppDelegate (MusicFreeScene)
- (void)loadReactNativeWindow:(NSDictionary *)launchOptions;
@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"MusicFree";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  // RCTAppDelegate 会在这里建好 window + RN rootView（只建一次）。
  // Scene 模式下 window 暂无 windowScene，由 willConnect 补挂。
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

#pragma mark - UISceneSession Lifecycle (CarPlay + main app)

/*
 * 只给 CarPlay 场景返回自定义配置；主 UIWindowScene 返回默认配置。
 * Expo 的 ExpoAppDelegate.swift 未实现本方法（TODO 注释），
 * 且 EXAppDelegateWrapper 子类方法优先于转发，所以本方法生效。
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
  return [[UISceneConfiguration alloc]
      initWithName:@"Default Configuration"
      sessionRole:connectingSceneSession.role];
}

/*
 * 主 App 黑屏修复（Phase 0.1）。
 *
 * 根因：Info.plist 声明 UIApplicationSceneManifest 后系统改走 UIScene
 *       生命周期。RCTAppDelegate 只在 didFinishLaunching 里用 legacy
 *       方式建 window（loadReactNativeWindow），那个 window 的
 *       windowScene 为 nil -> 不显示 -> 黑屏；它也不实现任何 scene 回调。
 *
 * 修法：在 willConnect 里把已建好的 window 关联到传入的 UIWindowScene。
 *       RCTAppDelegate 已声明 <UISceneDelegate>、window 属性公开，
 *       且其 loadReactNativeWindow 内部已设 windowScene.delegate = self。
 *
 * 时序兜底：若 willConnect 早于 didFinishLaunching（window 未建），
 *       延迟一帧再关联，此时 super 已把 window 建好。
 *
 * 只处理 UIWindowScene；CarPlay 场景由 MFCarPlaySceneDelegate 接管。
 */
- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions API_AVAILABLE(ios(13.0))
{
  if (![scene isKindOfClass:[UIWindowScene class]]) {
    return;
  }
  UIWindowScene *windowScene = (UIWindowScene *)scene;

  __weak __typeof(self) weakSelf = self;
  dispatch_block_t attach = ^{
    __strong __typeof(weakSelf) self = weakSelf;
    if (!self || !self.window) {
      return;
    }
    // 关键：把 window 挂到 scene，否则 Scene 模式下不显示
    [self.window setWindowScene:windowScene];
    [self.window makeKeyAndVisible];
  };

  if (self.window) {
    attach();
  } else {
    // 等 didFinishLaunching 建完 window 再补挂
    dispatch_async(dispatch_get_main_queue(), attach);
  }
}

@end
