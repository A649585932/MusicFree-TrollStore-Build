/*
 * CarPlaySceneDelegate.h — Phase 1
 * 车机界面：歌单列表 -> 曲目列表 -> 点播；另有"正在播放"tab。
 */
#import <Foundation/Foundation.h>
#import <CarPlay/CarPlay.h>

API_AVAILABLE(ios(14.0))
@interface MFCarPlaySceneDelegate : UIResponder <CPTemplateApplicationSceneDelegate,
                                                CPListTemplateDelegate>

@property (nonatomic, strong) CPInterfaceController *interfaceController;

@end
