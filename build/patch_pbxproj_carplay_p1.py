"""给 pbxproj 添加 CarPlayBridge.m/.h（Phase 1）"""
import io
import re

P = r'ios\MusicFree.xcodeproj\project.pbxproj'
s = io.open(P, encoding='utf-8').read()

if 'CarPlayBridge.m in Sources' in s:
    print('already present, skip')
    raise SystemExit(0)

H_REF = 'C4A9C9D0E5F6000000000011'
M_REF = 'C4A9C9D0E5F6000000000012'
M_BLD = 'C4A9C9D0E5F6000000000013'

# 1) PBXBuildFile
anchor = '\t\tC4A9C9D0E5F6000000000003 /* CarPlaySceneDelegate.m in Sources */ = {isa = PBXBuildFile; fileRef = C4A9C9D0E5F6000000000002 /* CarPlaySceneDelegate.m */; };'
assert anchor in s, 'buildfile anchor'
s = s.replace(anchor, anchor + f'\n\t\t{M_BLD} /* CarPlayBridge.m in Sources */ = {{isa = PBXBuildFile; fileRef = {M_REF} /* CarPlayBridge.m */; }};', 1)

# 2) PBXFileReference
anchor2 = '\t\tC4A9C9D0E5F6000000000002 /* CarPlaySceneDelegate.m */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.objc; name = CarPlaySceneDelegate.m; path = MusicFree/CarPlaySceneDelegate.m; sourceTree = "<group>"; };'
assert anchor2 in s, 'fileref anchor'
refs = (
    f'\t\t{H_REF} /* CarPlayBridge.h */ = {{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.h; name = CarPlayBridge.h; path = MusicFree/CarPlayBridge.h; sourceTree = "<group>"; }};\n'
    f'\t\t{M_REF} /* CarPlayBridge.m */ = {{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.objc; name = CarPlayBridge.m; path = MusicFree/CarPlayBridge.m; sourceTree = "<group>"; }};'
)
s = s.replace(anchor2, anchor2 + '\n' + refs, 1)

# 3) Sources phase
anchor3 = '\t\t\t\tC4A9C9D0E5F6000000000003 /* CarPlaySceneDelegate.m in Sources */,'
assert anchor3 in s, 'sources anchor'
s = s.replace(anchor3, anchor3 + f'\n\t\t\t\t{M_BLD} /* CarPlayBridge.m in Sources */,', 1)

# 4) group children
anchor4 = '\t\t\t\tC4A9C9D0E5F6000000000002 /* CarPlaySceneDelegate.m */,'
assert anchor4 in s, 'group anchor'
s = s.replace(anchor4, anchor4 + f'\n\t\t\t\t{H_REF} /* CarPlayBridge.h */,\n\t\t\t\t{M_REF} /* CarPlayBridge.m */,', 1)

print('  CarPlayBridge.m in Sources:', s.count('CarPlayBridge.m in Sources'))
print('  CarPlayBridge.h fileRef   :', 1 if H_REF in s else 0)
print('  CarPlayBridge.m fileRef   :', 1 if M_REF in s else 0)

io.open(P, 'w', encoding='utf-8').write(s)
print('written')
