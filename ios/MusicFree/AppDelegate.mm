#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"MusicFree";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  // RCTAppDelegate 在这里用 legacy 方式建好 window + RN rootView。
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

#pragma mark - UISceneDelegate (main app window)

/*
 * 方案 F：主 App 的 key window 接入 UIScene。
 *
 * 真机日志 v11142006 决定性证据：
 *   currentApplicationKeyWindow: 0x0
 *   evaluatedKeyWindowScene: <UIWindowScene 0x15df14e00>
 *   -> 系统创建了场景，但 RN 在 didFinishLaunching 里建的 legacy window
 *      没有关联到该场景，系统不认它是 key window，于是黑屏。
 *
 * 逐版复盘：
 *   v17        无 SceneManifest + AppDelegate 不实现任何 scene 方法
 *              -> UIKit 的 legacy 兼容逻辑把 UIApplicationDelegate.window
 *                 自动 attach 到默认 UIWindowScene -> 正常显示
 *   v11141849  声明主场景但没 delegateClass -> 没人负责 window -> 黑
 *   v11141931  写了 willConnect 但没 delegateClass -> 方法没被调用 -> 黑
 *   v11142006  实现 configurationForConnecting 对主场景 return nil
 *              -> 系统视为 scene-aware，legacy 自动 attach 被跳过，
 *                 而 nil 配置又没建出 window -> 黑
 *
 * 方案 F 把每一环都钉死：
 *   Info.plist 主场景 UISceneDelegateClassName = AppDelegate
 *   -> 系统必定回调本方法（v11141931 就是缺这一步才没生效）
 *   -> 这里把真正的 AppDelegate 实例持有的 window 挂到场景。
 *
 * 关键坑：UISceneDelegateClassName 指向的类可能被 UIKit 单独实例化，
 *   所以不能用 self.window（可能是新实例、为 nil），必须取
 *   UIApplication.sharedApplication.delegate —— 那才是持有
 *   RCTAppDelegate 建好的 window 的实例。
 *
 * CarPlay 场景由 MFCarPlaySceneDelegate 处理，传的是
 * CPTemplateApplicationScene（非 UIWindowScene），不会进这里。
 */
- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions API_AVAILABLE(ios(13.0))
{
  if (![scene isKindOfClass:[UIWindowScene class]]) {
    return;
  }
  UIWindowScene *windowScene = (UIWindowScene *)scene;

  __weak UIWindowScene *weakScene = windowScene;
  dispatch_block_t attach = ^{
    __strong UIWindowScene *ws = weakScene;
    if (!ws) {
      return;
    }
    // 取真正的 UIApplicationDelegate（持有 RN window 的实例）。
    // RCTAppDelegate 公开声明了 window 属性，直接强转即可，不用 performSelector。
    AppDelegate *realDelegate = (AppDelegate *)UIApplication.sharedApplication.delegate;
    UIWindow *win = realDelegate.window;
    if (win) {
      // 关键：把 RN 的 legacy window 关联到 UIWindowScene 并成为 key window
      [win setWindowScene:ws];
      [win makeKeyAndVisible];
      NSLog(@"[MusicFree] key window attached to scene: %@", win);
    } else {
      NSLog(@"[MusicFree] WARN: app window not ready yet");
    }
  };

  // didFinishLaunching 通常先于 willConnect，但保险起见两种情况都覆盖
  attach();
  dispatch_async(dispatch_get_main_queue(), attach);
}

@end
