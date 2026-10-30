"""The narration of 《提瓦特编年史》, with the picture each passage sits on.

Structure: CHAPTERS -> shots -> lines. A line is one TTS unit and one subtitle (split into two rows on screen when
long). A shot is what is on screen while its lines are read: a plate (pipeline/plates.py) or a code-drawn
diagram, a camera move and an overlay effect. `Q(...)` lines are quotations of in-game texts, read by the second
voice and set as a quote card.

Sources for every claim: docs/RESEARCH.md (wiki chronology, Fandom 2026-07 snapshot; BWIKI; the text of 《日月前事》).
Where the game only implies something, the narration hedges (「据说」「很可能」).
"""
from dataclasses import dataclass, field


@dataclass
class Line:
    text: str
    quote: bool = False      # read by the second voice, shown as a quote card
    pause: float = 0.0       # extra silence after the line (s)
    voice_text: str = ''     # what the TTS reads, when it differs from the subtitle (pronunciation fixes)
    plate: str = ''          # montage: this line's own plate (overrides the shot's)


@dataclass
class Shot:
    plate: str               # plate id, or 'diagram:<name>'
    lines: list[Line]
    move: str = 'push'       # camera: push | pull | pan-l | pan-r | rise | sink | still
    fx: str = 'motes'        # overlay: motes | embers | snow | abyss | rain | gold | stars | ash | bubbles | none
    focus: tuple[float, float] = (0.5, 0.5)   # where the camera move centres (plate uv)
    tag: str = ''            # an on-screen label (place / name card)
    bg: str = ''             # diagrams: the dimmed plate behind the drawing


@dataclass
class Chapter:
    id: str
    no: str                  # 卷一 ...
    title: str
    era: str                 # the year label on the chapter card and the ruler
    years: float             # years before present for the ruler marker (inf = before reckoning)
    element: str             # key colour of the chapter
    shots: list[Shot] = field(default_factory=list)


def L(text, pause=0.0, voice='', plate=''):
    return Line(text, False, pause, voice, plate)


def Q(text, pause=0.4):
    return Line(text, True, pause)


INF = float('inf')

CHAPTERS: list[Chapter] = [
    Chapter('prologue', '', '', '', INF, 'dendro', [
        Shot('diagram:tree', [
            L('在须弥的地脉深处，曾生长着一棵看不见的树。'),
            L('它叫伊尔明苏尔——世界树。', 0.4),
        ], move='still', fx='motes', bg='irminsul'),
        Shot('irminsul', [
            L('提瓦特发生过的一切，都会化作它的一片叶子：每一场战争，每一位神明，每一个被遗忘的名字。'),
            L('但这棵树并不可靠。它可以被篡改，被污染，也可以被抹去。'),
            L('它也只记得提瓦特之内的事。从世界之外到来的存在，不会在它的叶子上留下名字——'),
            L('可提瓦特的历史，偏偏一次又一次，被世界之外的来客改写。'),
            L('所以这部编年史，只能从散落世间的书页、遗迹与传说里，一片一片地拼回来。'),
            L('现在，让我们从最古老的那一页翻起。', 0.6),
        ], move='rise', fx='motes', focus=(0.5, 0.4)),
    ]),

    Chapter('dragons', '卷一', '龙之世', '纪年之前', INF, 'pyro', [
        Shot('dragons', [
            L('在「天」到来之前，提瓦特属于龙。'),
            L('那时的大地充盈着蛮荒的「光界力」。统领万物的，是龙王尼伯龙根，以及他麾下的七位元素龙王。'),
        ], move='push', fx='embers', tag='尼伯龙根与七元素龙王'),
        Shot('primordial', [
            L('每位龙王执掌一份元素的权能，大地随之分作七域。'),
            L('原始胎海覆盖着地表，几乎一切生命都源自那片温暖的水；草之龙王阿佩普的庭院里，长出了第一株蕨——那正是世界树最初的模样。'),
        ], move='pan-r', fx='motes'),
        Shot('tower', [
            L('龙族的文明远比后人想象的先进。他们仰望星空，在云端造起「天蛇船」，用它系住一道通往天外的长索。'),
        ], move='rise', fx='stars', focus=(0.5, 0.35)),
        Shot('moons', [
            L('尼伯龙根从大地上升起了三轮明月——恒月、霜月与虹月，并让三位月之女神代他治理世界。'),
            L('然后，他独自离开提瓦特，去往群星之间。'),
            L('那是提瓦特最后一段，头顶没有「天」的岁月。', 0.6),
        ], move='pull', fx='stars', focus=(0.5, 0.3)),
    ]),

    Chapter('doves', '卷二', '鸽子衔枝', '衔枝之年', INF, 'gold', [
        Shot('descent', [
            Q('「天上永恒的王座到来，世界为之焕然一新。」'),
            L('白夜国的禁书《日月前事》，用这样一句话，记下了下一个时代的开端。'),
            L('一位来自世界之外的存在降临了。书中称它「原初的那一位」，说它或许名叫法涅斯：生着羽翼，头戴王冠，从蛋中出生。'),
            L('后来，人们称它为「天理」。'),
        ], move='sink', fx='gold', focus=(0.5, 0.35)),
        Shot('diagram:shades', [
            L('它向七位龙王开战，并造出了自己发光的四道影子——'),
            L('生之执政纳贝里士，死之执政若娜瓦，时之执政伊斯塔露，空之执政阿斯莫代。', 0.3),
        ], move='still', fx='gold', bg='descent'),
        Shot('war', [
            Q('「四十个冬天埋葬了火，四十个夏天沸腾了海。」'),
            L('四十年后，七位龙王尽数败北。天理夺走了他们的权能，龙的子民逃入深海；没有参战的三月女神，则与天理立下了和约。'),
        ], move='push', fx='embers'),
        Shot('diagram:prism', [
            L('龙王们执掌的，是蛮荒的光界力。天理将它化分开来，变成了七种元素力：风、岩、雷、草、水、火、冰。'),
            L('纳塔的夜神打过一个比方：就像一道光芒经过折射，分解成彩虹的七种颜色。', 0.4),
        ], move='still', fx='gold', bg='descent'),
        Shot('falsesky', [
            L('据说，它还借用龙族遗留的技术，为提瓦特罩上了一层「虚假之天」，将这颗星球与外面的宇宙隔绝开来。'),
            L('世界树也被它改造，成了记录提瓦特万物、维系世界运转的装置。'),
        ], move='pull', fx='stars'),
        Shot('paradise', [
            Q('「最后它们造出了人。」'),
            L('衔枝后四百余年，天理与生之执政造出了飞鸟、走兽与花木，最后造出了人类。'),
            L('那是一段近乎乐园的岁月。天上的使者行走在人间，人们能直接聆听天空岛的启示；饥荒时会降下甘霖，贫瘠时大地会生出矿藏。'),
            L('唯一的禁忌，是「输给诱惑」。'),
            L('可人终究开始渴望天上的东西。', 0.6),
        ], move='pan-l', fx='motes'),
    ]),

    Chapter('flame', '卷三', '葬火之年', '约 6000 年前', 6000, 'abyss', [
        Shot('abyssdragon', [
            Q('「天上的第二个王座到来，仿佛创世之初的大战再开。那一天，天也倾颓，地也崩裂。」', 0.5),
            L('离开的龙王回来了。只是此时的尼伯龙根，带着来自世界之外的深渊之力。'),
            L('后世的考据大多认为，《日月前事》里的「第二个王座」，指的正是他。'),
        ], move='push', fx='abyss', focus=(0.5, 0.4)),
        Shot('shattered', [
            L('他向天理发动复仇之战，囚禁了三位月之女神，把三轮明月改造成了武器。'),
            L('天理击碎了恒月与虹月，又将霜月抛出了虚假之天。三团银辉，从此只余其一。'),
            L('约六千年前，天理付出惨重的代价，终于击杀了尼伯龙根。'),
        ], move='pull', fx='ash', focus=(0.5, 0.3)),
        Shot('nail', [
            L('为了净化大地上的深渊污染，它从天上降下巨大的钉子——天钉。'),
            L('天钉落下之处，文明随之终结。'),
        ], move='sink', fx='gold', focus=(0.5, 0.45)),
        Shot('vindagnyr', [
            L('雪山上的古国沙尔·芬德尼尔被永远冰封，', voice='雪山上的古国沙尔·芬德尼尔被永远冰封，'),
            L('须弥的雨林被埋进了赤红的沙海；传说璃月以西坠落的「天星」，砸出了层岩巨渊。'),
        ], move='pan-r', fx='snow', tag='沙尔·芬德尼尔'),
        Shot('enkanomiya', [
            L('而在大战之中，白夜国连同它的土地坠入了海渊。天理的禁令让他们找不到归途，在不见天日的黑暗里熬过了数千年。'),
        ], move='sink', fx='bubbles', tag='白夜国'),
        Shot('seelie', [
            L('天上的使者们也受到了惩罚。他们失去记忆与形体，化作了今天在原野上为人引路的小小仙灵。'),
            L('天理禁止世人知晓这场战争之前的历史。'),
        ], move='push', fx='motes'),
        Shot('khaenriah', [
            L('而大约在同一时期，在地底深处，一群不再信仰神明的人，建立起一个没有神的国度。'),
            L('它的名字，叫坎瑞亚。', 0.6),
        ], move='push', fx='ash', focus=(0.5, 0.55)),
    ]),

    Chapter('archonwar', '卷四', '魔神战争', '约 6000 – 2000 年前', 4000, 'geo', [
        Shot('diagram:thrones', [
            L('天理赢了，却也元气大伤。'),
            L('它用另一位「降临者」的遗骸铸成了七枚神之心，又用龙王们被夺走的权能造出了七个神座。'),
            L('天空岛的七个席位就此空出。大地上的魔神们为此厮杀了数千年——这便是魔神战争。'),
        ], move='still', fx='gold', bg='sleeping'),
        Shot('mondstadt_old', [
            L('在蒙德，龙卷之魔神迭卡拉庇安筑起风墙，把子民锁在高塔之下。'),
            L('两千六百年前，一位无名的诗人、一缕微弱的风之精灵，与反抗者们一起推翻了他。'),
            L('那缕风成为了风神巴巴托斯。他吹散冰雪，以那位诗人朋友的模样重塑了自己——他就是温迪。'),
        ], move='rise', fx='motes', tag='蒙德 · 风', focus=(0.5, 0.4)),
        Shot('liyue_old', [
            L('在璃月，岩之魔神摩拉克斯约三千七百年前建立了这个国度。他的盟友、尘之魔神归终陨落于战火，摩拉克斯带着子民南迁，建起了璃月港。'),
            L('他从天上掷下巨岩之枪，将漩涡之魔神奥赛尔镇压在孤云阁的海底。'),
        ], move='sink', fx='gold', tag='璃月 · 岩'),
        Shot('inazuma_old', [
            L('在稻妻，雷电真与雷电影这对双子，一人为神，一人为影。'),
            L('败走海渊的蛇神奥罗巴斯，最终倒在了雷电将军「无想的一刀」之下。'),
        ], move='push', fx='rain', tag='稻妻 · 雷'),
        Shot('sumeru_old', [
            L('在须弥，赤王、大慈树王与花神曾是挚友。'),
            L('花神逝去后，赤王在沙漠中触碰了禁忌知识，最终以自身的陨灭，终结了它带来的灾祸。'),
        ], move='pan-l', fx='ash', tag='须弥 · 草'),
        Shot('fontaine_old', [
            L('在枫丹，魔神雷穆斯建立了黄金帝国雷穆利亚，却连同他的理想一起沉入海底。'),
            L('天空岛命厄歌莉娅离开胎海，接过了水神之位。'),
        ], move='pull', fx='bubbles', tag='枫丹 · 水'),
        Shot('natlan_old', [
            L('纳塔则是龙的天下。葬火之战后，火之龙王修库特尔从沉眠中醒来，重新统治了那片土地。'),
            L('直到凡人希巴拉克击败了修库特尔，成为了第一位火神。'),
        ], move='push', fx='embers', tag='纳塔 · 火'),
        Shot('snezhnaya_old', [
            L('而在终年冰封的至冬，最初的冰神是一位君主，人们称他为「白沙皇」。'),
        ], move='pan-r', fx='snow', tag='至冬 · 冰'),
        Shot('diagram:seven', [
            L('两千年前，最后一个神座尘埃落定，尘世七执政就此确立。'),
            L('战败而不愿臣服的魔神，逃往了「暗之外海」的远岛。', 0.6),
        ], move='still', fx='gold', bg='sleeping'),
    ]),

    Chapter('golden', '卷五', '无神之国', '2000 – 500 年前', 1200, 'cryo', [
        Shot('khaenriah_gold', [
            L('在七国之下，坎瑞亚正走向它的黄金时代。'),
            L('这个不信神的国度依靠炼金术与机械，造出了强大的机械造物——遗迹守卫。'),
        ], move='pan-r', fx='ash', tag='坎瑞亚'),
        Shot('crimsonmoon', [
            L('坎瑞亚先后经历了两个王朝。赤月王朝崇拜高天之上的赤月之骸；后来，一场政变让黑日王朝取而代之。'),
            L('黑日王朝的最后一位国王，人称伊尔明；他的全名，是伊尔明苏尔。'),
            L('与世界树的名字，一模一样。', 0.6),
        ], move='push', fx='abyss', focus=(0.5, 0.35)),
    ]),

    Chapter('cataclysm', '卷六', '灾变', '500 年前', 500, 'abyss', [
        Shot('twins_fall', [
            L('五百多年前，一对来自世界之外的双子来到了提瓦特。'),
            L('那时的坎瑞亚正向天空祈求新的力量，而「天空回应了招唤」：双子中的一位，降临在了坎瑞亚。'),
            L('国王伊尔明立其为王储，奉为「救世主」——然后，将其当作容器，汲取无尽的深渊之力。'),
        ], move='sink', fx='stars', focus=(0.5, 0.4)),
        Shot('sinners', [
            L('国王日渐疯狂。他的近臣们发动政变，五人分走了这股力量，从此被称为「坎瑞亚的五大罪人」。'),
            L('失控的深渊涌向地上，魔物席卷了整个提瓦特。'),
        ], move='push', fx='abyss'),
        Shot('judgment', [
            L('七神降临坎瑞亚——唯有守护世界树的草神没有前往。这个无神的国度，在审判中覆灭。'),
            L('诅咒随之降临：混血的坎瑞亚人化作了丘丘人；死之执政若娜瓦则判纯血者以「不死」，让他们在漫长的岁月里慢慢磨损。', 0.4),
        ], move='pull', fx='gold', focus=(0.5, 0.3)),
        Shot('durin', [
            L('灾变的余波，几乎改写了每一个国家。'),
            L('在蒙德，「黄金」造出的魔龙杜林袭击城市。风神唤来风龙特瓦林将它击杀，特瓦林却因此咽下了它的毒血。'),
        ], move='push', fx='ash', tag='蒙德'),
        Shot('chasm', [
            L('在璃月，层岩巨渊涌出魔物，夜叉与千岩军以性命将它们封入地底。'),
        ], move='sink', fx='ash', tag='璃月'),
        Shot('sakura', [
            L('在稻妻，雷电真死于坎瑞亚，雷电影接过了神位，也接过了她未竟的梦。'),
        ], move='rise', fx='motes', tag='稻妻'),
        Shot('amrita', [
            L('在须弥，大慈树王被禁忌知识污染，在消逝之前，留下了新生的小吉祥草王。'),
            L('枫丹的水神厄歌莉娅也陨落了。她的眷属芙卡洛斯继承了神座，也继承了一则预言：所有枫丹人，终将溶于海水。'),
        ], move='pan-l', fx='motes', tag='须弥 · 枫丹'),
        Shot('nightwar', [
            L('纳塔受创最深。深渊侵蚀了夜神之国，火神玛薇卡把自己的生命存入圣火，与族人约定五百年后再战。'),
        ], move='push', fx='embers', tag='纳塔'),
        Shot('cubes', [
            L('而那对双子，试图离开这个世界，却被空之执政阿斯莫代拦下。'),
            L('一位被她封印，陷入沉睡；另一位，被她带走。'),
            L('沉睡的那一位，就是我们的旅行者。', 0.8),
        ], move='push', fx='gold', focus=(0.5, 0.45)),
    ]),

    Chapter('aftermath', '卷七', '五百年', '500 年前 – 现在', 250, 'electro', [
        Shot('abyssorder', [
            L('灾变之后的五百年，各国都背负着伤口前行。'),
            L('坎瑞亚的遗民建立了深渊教团，誓要向天理与七神复仇。旅行者的血亲早已醒来，后来成为了教团的主人。'),
        ], move='push', fx='abyss'),
        Shot('fatui', [
            L('在至冬，冰之女皇与执行官们组建了愚人众，开始收集七国的神之心。'),
            L('她要挑战的，是天理本身。'),
        ], move='pan-r', fx='snow', tag='至冬'),
        Shot('euthymia', [
            L('雷电影把自己关进一心净土，以「永恒」对抗一切的磨损。'),
            L('芙卡洛斯把自己一分为二，让一个名叫芙宁娜的人，在审判庭上独自扮演了五百年的神明。'),
            L('年幼的小吉祥草王，被教令院的贤者们囚禁在净善宫里。'),
        ], move='push', fx='motes'),
        Shot('sleeping', [
            L('而天理，自灾变之后便陷入了沉睡。'),
            L('没有人知道，它何时会醒来。', 0.8),
        ], move='pull', fx='stars', focus=(0.5, 0.3)),
    ]),

    Chapter('traveler', '卷八', '旅人', '现在', 0, 'anemo', [
        Shot('awaken', [
            L('五百年后，旅行者醒来，与派蒙一起，踏上了寻找血亲的旅途。'),
        ], move='pan-r', fx='motes', focus=(0.5, 0.5)),
        Shot('diagram:journey', [
            L('在蒙德，被深渊蛊惑的风龙，重新找回了自己。', plate='j_mondstadt'),
            L('在璃月，岩神「死」于一场请仙典仪——那是一场漫长的告别。摩拉克斯依照契约，交出了自己的神之心。', plate='j_liyue'),
            L('在稻妻，旅行者以凡人的愿望，斩开了雷神的「永恒」，眼狩令就此废止。', plate='j_inazuma'),
            L('在须弥，纳西妲走出了囚笼。她依照大慈树王的遗愿，将前代草神连同禁忌知识，一起从世界树中抹去。', plate='j_sumeru'),
            L('在枫丹，预言如期而至。芙卡洛斯以神座为代价审判了自己，把水的权能还给了水龙王那维莱特。', 0.3, plate='j_fontaine'),
            L('龙王，在这一刻归来。', plate='j_dragon'),
            L('在纳塔，与深渊之间旷日持久的战争，终于迎来了终章。', plate='j_natlan'),
        ], move='push', fx='motes'),
        Shot('nodkrai', [
            L('在挪德卡莱，那片据说由「未能成为月亮的残骸」化成的边境，三月的往事重见天日，失落的月光有了新的继承者。'),
        ], move='rise', fx='snow', tag='挪德卡莱', focus=(0.5, 0.35)),
        Shot('snezhnaya', [
            L('而现在，旅行者已经踏上了至冬的冰原——七国的最后一站。'),
            L('女皇与天理之间那盘下了五百年的棋，正在走向终局。', 0.8),
        ], move='push', fx='snow', tag='至冬'),
    ]),

    Chapter('epilogue', '尾声', '未完的记录', '', 0, 'dendro', [
        # the four cycles: the tower of the Narcissenkreuz Ordo (自体自身之塔, its plaque and the 根源之轮 keys) and
        # René's notes (神秘的书页·其一); RESEARCH.md 「四个轮回」
        Shot('diagram:cycles', [
            L('从龙的时代，到天理的时代；从神的时代，到人的时代。'),
            L('提瓦特的历史，是一次又一次的覆灭与重来。'),
            L('枫丹的水仙十字结社相信，人会在一轮又一轮的轮回中不断完善。'),
            L('他们结合古代文献，为这些轮回取了名字：亥珀波瑞亚、纳塔兰提亚、雷穆利亚，以及如今才走到一半的第四轮，克劳雅利亚。'),
            L('在他们看来，人类的精神依次经历失乐园、战胜恶龙、原罪与洗礼，最后，从神那里获得自由。'),
            L('可结社的创始人雷内，用他推导出的「世界式」反复推演，结果始终一样：'),
            L('这一轮之后，不会再有新的文明诞生——除非，引入系统之外的「变量」。', 0.6),
        ], move='still', fx='stars', bg='ruins_sky'),
        Shot('ruins_sky', [
            L('天理用天钉与禁令把过去埋进地底；世界树里的记忆，也可以被一笔抹去。'),
            L('就在不久前，被「博士」污染的世界树在火中燃尽；它的职责，由赤王留下的「阿如」接了过去。'),
        ], move='pull', fx='stars'),
        Shot('irminsul_end', [
            L('可总有人记得——用一本禁书，一首歌，一个五百年不变的约定。'),
            L('提瓦特的编年史，到这里还没有写完。'),
            L('最后的几页，正由一位来自世界之外、世界树也无从记录的旅行者书写。', 1.2),
        ], move='rise', fx='motes', focus=(0.5, 0.4)),
    ]),
]


def all_lines():
    for c in CHAPTERS:
        for s in c.shots:
            for l in s.lines:
                yield c, s, l


if __name__ == '__main__':
    n = sum(len(l.text) for _, _, l in all_lines())
    print(sum(1 for _ in all_lines()), 'lines,', n, 'chars')
    for c in CHAPTERS:
        print(c.id, sum(len(l.text) for s in c.shots for l in s.lines))
