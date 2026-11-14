"""给 pbxproj 添加 CarPlaySceneDelegate.h/.m 引用 + 弱链接 CarPlay.framework"""
import io

P = r'ios\MusicFree.xcodeproj\project.pbxproj'
s = io.open(P, encoding='utf-8').read()

# 固定 UUID（24 hex，与现有风格一致，且与已有不冲突）
# 用 CPLAY 前缀的伪十六进制
H_REF = 'C4A9C9D0E5F6000000000001'
M_REF = 'C4A9C9D0E5F6000000000002'
M_BLD = 'C4A9C9D0E5F6000000000003'

# 1) PBXBuildFile 段：加 .m in Sources
anchor = '\t\t13B07FBC1A68108700A75B9A /* AppDelegate.mm in Sources */ = {isa = PBXBuildFile; fileRef = 13B07FB01A68108700A75B9A /* AppDelegate.mm */; };'
assert anchor in s, 'buildfile anchor missing'
build_line = f'\t\t{M_BLD} /* CarPlaySceneDelegate.m in Sources */ = {{isa = PBXBuildFile; fileRef = {M_REF} /* CarPlaySceneDelegate.m */; }};'
s = s.replace(anchor, anchor + '\n' + build_line, 1)

# 2) PBXFileReference 段：加 .h / .m
anchor2 = '\t\t13B07FB01A68108700A75B9A /* AppDelegate.mm */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.cpp.objcpp; name = AppDelegate.mm; path = MusicFree/AppDelegate.mm; sourceTree = "<group>"; };'
assert anchor2 in s, 'fileref anchor missing'
ref_lines = (
    f'\t\t{H_REF} /* CarPlaySceneDelegate.h */ = {{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.h; name = CarPlaySceneDelegate.h; path = MusicFree/CarPlaySceneDelegate.h; sourceTree = "<group>"; }};\n'
    f'\t\t{M_REF} /* CarPlaySceneDelegate.m */ = {{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.objc; name = CarPlaySceneDelegate.m; path = MusicFree/CarPlaySceneDelegate.m; sourceTree = "<group>"; }};'
)
s = s.replace(anchor2, anchor2 + '\n' + ref_lines, 1)

# 3) PBXSourcesBuildPhase：主 target（13B07F87）的 files 里加 .m
anchor3 = '\t\t\t\t13B07FBC1A68108700A75B9A /* AppDelegate.mm in Sources */,'
assert anchor3 in s, 'sources anchor missing'
s = s.replace(anchor3, anchor3 + f'\n\t\t\t\t{M_BLD} /* CarPlaySceneDelegate.m in Sources */,', 1)

# 4) PBXGroup：把 .h/.m 加进 MusicFree 组（找包含 AppDelegate.mm 的 group）
#    直接把引用插到 AppDelegate.mm 那行后面（同一 group 的 children）
anchor4 = '\t\t\t\t13B07FB01A68108700A75B9A /* AppDelegate.mm */,'
if anchor4 in s:
    s = s.replace(anchor4, anchor4 + f'\n\t\t\t\t{H_REF} /* CarPlaySceneDelegate.h */,\n\t\t\t\t{M_REF} /* CarPlaySceneDelegate.m */,', 1)
    print('  group children updated')
else:
    print('  WARN: group children anchor not found (build may still work via path)')

# 5) OTHER_LDFLAGS：给 4 个 target 都加 -weak_framework CarPlay
cnt = 0
out = []
for line in s.split('\n'):
    out.append(line)
    if '"-lc++"' in line:
        # 在下一行前插入弱链接？改为在 "-ObjC" 行后插入更稳
        pass
s = '\n'.join(out)
# 简单可靠：把每个 OTHER_LDFLAGS 数组里的 "$(inherited)" 前插入弱链接
import re
def add_weak(m):
    global cnt
    block = m.group(0)
    if 'CarPlay' in block:
        return block
    # 在数组结束前插一行
    cnt += 1
    return block.replace('\t\t\t\t);', '\t\t\t\t\t"-weak_framework CarPlay",\n\t\t\t\t);', 1)
s = re.sub(r'OTHER_LDFLAGS = \(\n(?:.*\n)*?\t\t\t\t\);', add_weak, s)
print(f'  OTHER_LDFLAGS 更新 {cnt} 处')

# 6) 校验
checks = {
    'CarPlaySceneDelegate.m in Sources': s.count('CarPlaySceneDelegate.m in Sources'),
    'CarPlaySceneDelegate.h fileRef': 1 if H_REF in s else 0,
    'CarPlaySceneDelegate.m fileRef': 1 if M_REF in s else 0,
    '-weak_framework CarPlay': s.count('"-weak_framework CarPlay"'),
    'CarPlay.framework': s.count('CarPlay.framework'),
}
for k, v in checks.items():
    print(f'  {k}: {v}')

io.open(P, 'w', encoding='utf-8').write(s)
print('written')
