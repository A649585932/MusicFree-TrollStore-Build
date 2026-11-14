/*
 * CarPlaySceneDelegate.h
 * Phase 0 minimal probe: prove CarPlay entitlement + scene work on TrollStore.
 *
 * Only builds a static CPListTemplate + CPNowPlayingTemplate.
 * No RN bridge yet (Phase 1). If the CarPlay screen shows this app,
 * the entitlement path is valid and we wire up real playback.
 */
#import <Foundation/Foundation.h>
#import <CarPlay/CarPlay.h>

API_AVAILABLE(ios(14.0))
@interface MFCarPlaySceneDelegate : UIResponder <CPTemplateApplicationSceneDelegate>

@property (nonatomic, strong) CPInterfaceController *interfaceController;

@end
