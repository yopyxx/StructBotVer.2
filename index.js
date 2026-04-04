// @ts-nocheck
/**
 * Discord.js v14 - 편제(조직표) 관리 봇 최적화 버전
 *
 * 변경사항
 * - 역할 ID 전체 갱신
 * - 권한 역할 갱신
 * - 빠지면 안 되는 역할 유지 로직 추가
 * - 전체추가 시 서버에 없거나 필수 역할(1434909470106058842) 없으면 자동 제외
 * - 소령/중령/대령 전체추가 기준 역할 변경
 * - 편제전체추가 명령어는 역할 추가/제거 없이 편제 데이터만 동기화
 */

const fs = require("fs");
const path = require("path");
const {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const CONFIG = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  dataFile: path.join(__dirname, "organization.json"),

  superAdminIds: new Set([
    "942558158436589640",
    "1369378060557877480",
  ]),

  levelRoles: {
    1: ["1489031147022450921"],
    2: ["1489031132854095944"],
    3: ["1432002835264045147"],
  },

  dismissRoles: [
    "1432007526337089546",
    "1489031175816351754",
    "1432006106800197665",
    "1434909470106058842",
    "1489031154689638581",
  ],

  deptAssignRoles: {
    대령: [
      "1432007526337089546",
      "1489031175816351754",
      "1432006106800197665",
      "1434909470106058842",
      "1489031154689638581",
      "1489031147022450921",
    ],
    중령: [
      "1432007526337089546",
      "1489031175816351754",
      "1432006106800197665",
      "1434909470106058842",
      "1489031154689638581",
      "1489031153330688040",
      "1432005794135802007",
    ],
    소령: [
      "1432007526337089546",
      "1489031175816351754",
      "1432006106800197665",
      "1434909470106058842",
      "1489031154689638581",
      "1432005794135802007",
    ],
  },

  preserveRoles: new Set([
    "1475737964352110703",
    "1449933125424648263",
  ]),

  requiredSyncRole: "1434909470106058842",

  hqPositions: [
    "교육사령관",
    "교육부사령관",
    "교육훈련부장",
    "종합행정학교장",
    "참모장",
    "인사행정단장",
    "기획관리단장",
    "법무관리단장",
    "주임원사",
  ],

  hqEmojis: {
    교육사령관: "<:General:1478002425830047754>",
    교육부사령관: "<:LieutenantGeneral:1480151141969956944>",
    교육훈련부장: "<:LieutenantGeneral:1480151141969956944>",
    종합행정학교장: "<:LieutenantGeneral:1480151141969956944>",
    참모장: "<:brigadier:1478002619577405500>",
    인사행정단장: "<:brigadier:1478002619577405500>",
    기획관리단장: "<:brigadier:1478002619577405500>",
    법무관리단장: "<:brigadier:1478002619577405500>",
    주임원사: "<:sergeantmajor:1478002719645106248>",
  },

  orgEmojis: {
    colonel: "<:Colonel:1478005729146179645>",
    ltcolonel: "<:Lieutenant_Colonel:1478005839427141744>",
    major: "<:Major:1478005902702284971>",
  },

  limits: {
    대령: 13,
    중령: 28,
    소령: 50,
  },

  allowedNoticeChannelTypes: new Set([
    ChannelType.GuildText,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ]),

  syncRoles: {
    소령: {
      include: ["1432005794135802007"],
      exclude: ["1489031153330688040", "1489031147022450921"],
    },
    중령: {
      include: ["1432005794135802007", "1489031153330688040"],
      exclude: ["1489031147022450921"],
    },
    대령: {
      include: ["1489031147022450921"],
      exclude: [],
    },
  },
};

const DEPARTMENTS = Object.keys(CONFIG.limits);

function createDefaultData() {
  return {
    편제: {
      사령본부: [],
      대령: [],
      중령: [],
      소령: [],
    },
    공지: {
      messageId: null,
      channelId: null,
    },
  };
}

function sanitizeNickname(nickname) {
  if (!nickname) return "";

  return String(nickname)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^\)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStoredMember(member) {
  if (!member || typeof member !== "object") return null;

  return {
    ...member,
    id: member.id ? String(member.id) : member.id,
    nickname: sanitizeNickname(member.nickname || ""),
  };
}

function normalizeData(rawData) {
  const base = createDefaultData();
  const data = rawData && typeof rawData === "object" ? rawData : {};
  const organization = data.편제 && typeof data.편제 === "object" ? data.편제 : {};
  const notice = data.공지 && typeof data.공지 === "object" ? data.공지 : {};

  const normalized = {
    편제: {
      ...base.편제,
      ...organization,
    },
    공지: {
      ...base.공지,
      ...notice,
    },
  };

  for (const key of Object.keys(base.편제)) {
    if (!Array.isArray(normalized.편제[key])) {
      normalized.편제[key] = [];
    }
  }

  for (const dept of DEPARTMENTS) {
    normalized.편제[dept] = normalized.편제[dept]
      .map(normalizeStoredMember)
      .filter(Boolean);
  }

  normalized.편제.사령본부 = normalized.편제.사령본부
    .map((member) => {
      if (!member || typeof member !== "object") return null;
      return {
        ...member,
        id: member.id ? String(member.id) : member.id,
        nickname: sanitizeNickname(member.nickname || ""),
      };
    })
    .filter(Boolean);

  return normalized;
}

function loadData() {
  if (!fs.existsSync(CONFIG.dataFile)) {
    return createDefaultData();
  }

  try {
    const raw = fs.readFileSync(CONFIG.dataFile, "utf8");
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    console.error("organization.json 파싱 실패:", error);
    return createDefaultData();
  }
}

function saveData(data) {
  fs.writeFileSync(
    CONFIG.dataFile,
    JSON.stringify(normalizeData(data), null, 2),
    "utf8"
  );
}

let store = loadData();

function getUserLevel(member) {
  if (!member) return 0;

  if (CONFIG.superAdminIds.has(String(member.id))) {
    return 999;
  }

  const roles = member.roles?.cache;
  if (!roles) return 0;

  const roleIds = new Set(roles.map((role) => String(role.id)));
  const levels = Object.keys(CONFIG.levelRoles)
    .map(Number)
    .sort((a, b) => b - a);

  for (const level of levels) {
    if (CONFIG.levelRoles[level].some((roleId) => roleIds.has(roleId))) {
      return level;
    }
  }

  return 0;
}

async function fetchMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}

async function reply(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload).catch(() => null);
  }

  return interaction.reply(payload).catch(() => null);
}

async function replyError(interaction, content) {
  return reply(interaction, { content, ephemeral: true });
}

async function replySuccess(interaction, content, ephemeral = true) {
  return reply(interaction, { content, ephemeral });
}

function removeUserFromOrganization(targetId) {
  const normalizedId = String(targetId);
  let removed = false;

  for (const dept of DEPARTMENTS) {
    const before = store.편제[dept].length;
    store.편제[dept] = store.편제[dept].filter(
      (member) => String(member.id) !== normalizedId
    );
    removed ||= before !== store.편제[dept].length;
  }

  const beforeHQ = store.편제.사령본부.length;
  store.편제.사령본부 = store.편제.사령본부.filter(
    (member) => String(member.id) !== normalizedId
  );
  removed ||= beforeHQ !== store.편제.사령본부.length;

  return removed;
}

async function replaceMemberRoles(member, roleIds, guild) {
  const removableRoles = member.roles.cache.filter((role) => {
    if (role.id === guild.id) return false;
    if (CONFIG.preserveRoles.has(String(role.id))) return false;
    return true;
  });

  if (removableRoles.size > 0) {
    await member.roles.remove(removableRoles);
  }

  if (roleIds?.length) {
    await member.roles.add(roleIds);
  }
}

function formatMemberLine(member, nickname, highlightUserId = null) {
  const isHighlighted =
    highlightUserId && String(member.id) === String(highlightUserId);

  const cleanNickname = sanitizeNickname(nickname) || member.displayName;

  return isHighlighted
    ? `**${member} / ${cleanNickname} ⭐**`
    : `${member} / ${cleanNickname}`;
}

function buildHeadquartersEmbed(guild, highlightUserId = null) {
  const lines = CONFIG.hqPositions.map((position) => {
    const emoji = CONFIG.hqEmojis[position] || "";
    const savedMember = store.편제.사령본부.find(
      (member) => member.position === position
    );

    if (!savedMember) {
      return `${emoji} | ${position} : 공석`;
    }

    const guildMember = guild.members.cache.get(String(savedMember.id));
    if (!guildMember) {
      return `${emoji} | ${position} : 공석`;
    }

    const line = formatMemberLine(
      guildMember,
      savedMember.nickname,
      highlightUserId
    );

    return `${emoji} | ${position} : ${line}`;
  });

  return new EmbedBuilder()
    .setColor(0x1f3a93)
    .setTitle("📋 사령본부 편제 현황")
    .setDescription(["사령본부", ...lines].join("\n"));
}

function buildDepartmentLines(memberCache, dept, highlightUserId = null) {
  return store.편제[dept]
    .map((savedMember) => {
      const guildMember = memberCache.get(String(savedMember.id));
      if (!guildMember) return null;
      return formatMemberLine(guildMember, savedMember.nickname, highlightUserId);
    })
    .filter(Boolean);
}

function buildOrganizationEmbed(guild, highlightUserId = null) {
  const memberCache = guild.members.cache;

  const colonelMembers = buildDepartmentLines(memberCache, "대령", highlightUserId);
  const ltcolonelMembers = buildDepartmentLines(memberCache, "중령", highlightUserId);
  const majorMembers = buildDepartmentLines(memberCache, "소령", highlightUserId);

  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("📋 재정·인사교육단 편제 현황")
    .setDescription(
      [
        `${CONFIG.orgEmojis.colonel} | 재정교육단 (대령 : ${store.편제.대령.length}/${CONFIG.limits.대령})`,
        ...(colonelMembers.length ? colonelMembers : ["없음"]),
        "",
        `${CONFIG.orgEmojis.ltcolonel} | 인사교육단 (중령 : ${store.편제.중령.length}/${CONFIG.limits.중령})`,
        ...(ltcolonelMembers.length ? ltcolonelMembers : ["없음"]),
        "",
        `${CONFIG.orgEmojis.major} | 인사교육단 (소령 : ${store.편제.소령.length}/${CONFIG.limits.소령})`,
        ...(majorMembers.length ? majorMembers : ["없음"]),
      ].join("\n")
    );
}

function buildEmbeds(guild, highlightUserId = null) {
  return [
    buildHeadquartersEmbed(guild, highlightUserId),
    buildOrganizationEmbed(guild, highlightUserId),
  ];
}

async function refreshNoticeIfExists(guild) {
  const { messageId, channelId } = store.공지 || {};
  if (!messageId || !channelId) return;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return;

    await message.edit({ embeds: buildEmbeds(guild) }).catch(() => null);
  } catch (error) {
    console.error("공지 자동 갱신 실패:", error);
  }
}

async function persistStore(guild) {
  store = normalizeData(store);
  saveData(store);
  await refreshNoticeIfExists(guild);
}

function canManageNoticeChannel(channel) {
  return channel.isTextBased() && CONFIG.allowedNoticeChannelTypes.has(channel.type);
}

function isUserInOrganization(userId) {
  const normalizedId = String(userId);

  if (
    store.편제.사령본부.some((member) => String(member.id) === normalizedId)
  ) {
    return true;
  }

  return DEPARTMENTS.some((dept) =>
    store.편제[dept].some((member) => String(member.id) === normalizedId)
  );
}

function assertEnv() {
  if (!CONFIG.token) throw new Error("TOKEN 환경변수가 없습니다.");
  if (!CONFIG.clientId) throw new Error("CLIENT_ID 환경변수가 없습니다.");
  if (!CONFIG.guildId) throw new Error("GUILD_ID 환경변수가 없습니다.");
}

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("편제추가")
      .setDescription("대령 / 중령 / 소령 편제에 인원을 추가합니다.")
      .addStringOption((option) =>
        option
          .setName("부서")
          .setDescription("추가할 부서")
          .setRequired(true)
          .addChoices(
            { name: "대령", value: "대령" },
            { name: "중령", value: "중령" },
            { name: "소령", value: "소령" }
          )
      )
      .addUserOption((option) =>
        option.setName("대상").setDescription("추가할 멤버").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("닉네임").setDescription("표기할 닉네임").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("사령본부추가")
      .setDescription("사령본부 직책에 인원을 배치합니다.")
      .addStringOption((option) => {
        option.setName("직책").setDescription("직책 선택").setRequired(true);
        for (const position of CONFIG.hqPositions) {
          option.addChoices({ name: position, value: position });
        }
        return option;
      })
      .addUserOption((option) =>
        option.setName("대상").setDescription("배치할 멤버").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("닉네임").setDescription("표기할 닉네임").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("편제삭제")
      .setDescription("등록된 인원을 모든 편제에서 제거합니다.")
      .addUserOption((option) =>
        option.setName("대상").setDescription("삭제할 멤버").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("편제현황")
      .setDescription("현재 사령본부 및 교육단 편제 현황을 확인합니다."),

    new SlashCommandBuilder()
      .setName("찾기")
      .setDescription("멘션한 인원이 어느 편제에 있는지 확인합니다.")
      .addUserOption((option) =>
        option.setName("대상").setDescription("찾을 멤버").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("공지")
      .setDescription("현재 편제현황을 지정 채널에 공지로 등록합니다.")
      .addChannelOption((option) =>
        option.setName("채널").setDescription("공지할 채널").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("공지수정")
      .setDescription("등록된 편제 공지를 최신 정보로 수정합니다."),

    new SlashCommandBuilder()
      .setName("해임")
      .setDescription("해당 유저의 모든 역할을 제거하고 기본 역할을 부여합니다.")
      .addUserOption((option) =>
        option.setName("대상").setDescription("해임할 유저").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("소령편제전체추가")
      .setDescription("소령 역할 보유자를 전부 소령 편제에 동기화합니다. (역할 변경 없음)"),

    new SlashCommandBuilder()
      .setName("중령편제전체추가")
      .setDescription("중령 역할 조건 충족자를 전부 중령 편제에 동기화합니다. (역할 변경 없음)"),

    new SlashCommandBuilder()
      .setName("대령편제전체추가")
      .setDescription("대령 역할 보유자를 전부 대령 편제에 동기화합니다. (역할 변경 없음)"),
  ].map((command) => command.toJSON());
}

async function registerCommands() {
  assertEnv();

  const rest = new REST({ version: "10" }).setToken(CONFIG.token);
  const commands = buildCommands();

  await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: [] });
  console.log("✅ 글로벌 슬래시 명령어 정리 완료");

  await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId), {
    body: commands,
  });
  console.log("✅ 길드 슬래시 명령어 등록 완료");
}

async function handleAddOrganizationMember({ interaction, guild, userLevel }) {
  const dept = interaction.options.getString("부서", true);
  const targetUser = interaction.options.getUser("대상", true);
  const nicknameInput = interaction.options.getString("닉네임", true);
  const nickname = sanitizeNickname(nicknameInput);

  if (userLevel === 0) {
    return replyError(interaction, "❌ 권한이 없습니다.");
  }

  if (userLevel === 1 && dept !== "소령") {
    return replyError(
      interaction,
      "❌ Level 1 권한은 소령 편제만 추가 가능합니다."
    );
  }

  if (!CONFIG.limits[dept]) {
    return replyError(interaction, "❌ 잘못된 부서입니다.");
  }

  const targetMember = await fetchMember(guild, targetUser.id);
  if (!targetMember) {
    return replyError(interaction, "❌ 대상 멤버를 찾을 수 없습니다.");
  }

  const currentDeptMembers = store.편제[dept];
  const alreadyInSameDept = currentDeptMembers.some(
    (member) => String(member.id) === String(targetUser.id)
  );

  if (!alreadyInSameDept && currentDeptMembers.length >= CONFIG.limits[dept]) {
    return replyError(interaction, "❌ 최대 인원 초과");
  }

  removeUserFromOrganization(targetUser.id);
  store.편제[dept].push({
    id: String(targetUser.id),
    nickname:
      nickname ||
      sanitizeNickname(targetMember.displayName) ||
      targetMember.displayName,
  });

  await replaceMemberRoles(targetMember, CONFIG.deptAssignRoles[dept], guild);
  await persistStore(guild);

  return replySuccess(
    interaction,
    `✅ ${targetUser} 님을 ${dept} 편제에 등록했고, 역할을 새로 적용했습니다.`
  );
}

async function handleAddHeadquartersMember({ interaction, guild, userLevel }) {
  const position = interaction.options.getString("직책", true);
  const targetUser = interaction.options.getUser("대상", true);
  const nicknameInput = interaction.options.getString("닉네임", true);
  const nickname = sanitizeNickname(nicknameInput);

  if (userLevel < 3) {
    return replyError(
      interaction,
      "❌ Level 3 이상만 사령본부 수정이 가능합니다."
    );
  }

  store.편제.사령본부 = store.편제.사령본부.filter(
    (member) =>
      member.position !== position && String(member.id) !== String(targetUser.id)
  );

  store.편제.사령본부.push({
    position,
    id: String(targetUser.id),
    nickname,
  });

  await persistStore(guild);
  return replySuccess(interaction, `✅ ${targetUser} → ${position} 등록 완료`);
}

async function handleRemoveOrganizationMember({ interaction, guild, userLevel }) {
  const targetUser = interaction.options.getUser("대상", true);

  if (userLevel < 2) {
    return replyError(interaction, "❌ Level 2 이상만 사용 가능합니다.");
  }

  const removed = removeUserFromOrganization(targetUser.id);
  await persistStore(guild);

  if (removed) {
    return replySuccess(interaction, `✅ ${targetUser} 편제에서 삭제 완료`);
  }

  return replySuccess(interaction, "해당 인원은 등록되어 있지 않습니다.");
}

async function handleShowOrganization({ interaction, guild, userLevel }) {
  if (userLevel < 1) {
    return replyError(interaction, "❌ Level 1 이상만 사용 가능합니다.");
  }

  return reply(interaction, {
    embeds: buildEmbeds(guild),
    ephemeral: true,
  });
}

async function handleFindMember({ interaction, guild }) {
  const targetUser = interaction.options.getUser("대상", true);

  if (!isUserInOrganization(targetUser.id)) {
    return replySuccess(interaction, "해당 인원은 편제에 없습니다.");
  }

  return reply(interaction, {
    embeds: buildEmbeds(guild, targetUser.id),
    ephemeral: true,
  });
}

async function handleCreateNotice({ interaction, guild, userLevel }) {
  const channel = interaction.options.getChannel("채널", true);

  if (userLevel < 2) {
    return replyError(interaction, "❌ Level 2 이상만 공지가 가능합니다.");
  }

  if (!canManageNoticeChannel(channel)) {
    return replyError(interaction, "❌ 텍스트 채널만 선택 가능합니다.");
  }

  const message = await channel.send({ embeds: buildEmbeds(guild) });
  store.공지.messageId = message.id;
  store.공지.channelId = channel.id;
  saveData(store);

  return replySuccess(interaction, "✅ 편제 공지 생성 완료");
}

async function handleUpdateNotice({ interaction, guild, userLevel }) {
  if (userLevel < 3) {
    return replyError(
      interaction,
      "❌ Level 3 이상만 공지수정이 가능합니다."
    );
  }

  const { messageId, channelId } = store.공지;
  if (!messageId || !channelId) {
    return replyError(interaction, "❌ 등록된 공지가 없습니다.");
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return replyError(interaction, "❌ 채널을 찾을 수 없습니다.");
  }

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    return replyError(interaction, "❌ 기존 공지를 찾을 수 없습니다.");
  }

  await message.edit({ embeds: buildEmbeds(guild) });
  return replySuccess(interaction, "✅ 편제 공지 수정 완료");
}

async function handleDismissMember({ interaction, guild, userLevel }) {
  const targetUser = interaction.options.getUser("대상", true);

  if (userLevel < 2) {
    return replyError(interaction, "❌ Level 2 이상만 사용 가능합니다.");
  }

  const targetMember = await fetchMember(guild, targetUser.id);
  if (!targetMember) {
    return replyError(interaction, "❌ 유저를 찾을 수 없습니다.");
  }

  const removedFromOrg = removeUserFromOrganization(targetMember.id);
  await replaceMemberRoles(targetMember, CONFIG.dismissRoles, guild);
  await persistStore(guild);

  return replySuccess(
    interaction,
    removedFromOrg
      ? `⚠️ ${targetMember} 해임 처리 완료 (편제 자동 삭제 포함)`
      : `⚠️ ${targetMember} 해임 처리 완료`,
    false
  );
}

function hasAllRoles(member, roleIds = []) {
  if (!member?.roles?.cache) return false;
  return roleIds.every((roleId) => member.roles.cache.has(String(roleId)));
}

function hasAnyRole(member, roleIds = []) {
  if (!member?.roles?.cache) return false;
  return roleIds.some((roleId) => member.roles.cache.has(String(roleId)));
}

function getSyncTargetMembers(guild, dept) {
  const syncConfig = CONFIG.syncRoles[dept];
  if (!syncConfig) return [];

  return guild.members.cache.filter((member) => {
    if (member.user.bot) return false;
    if (!member.roles.cache.has(CONFIG.requiredSyncRole)) return false;
    if (!hasAllRoles(member, syncConfig.include)) return false;
    if (hasAnyRole(member, syncConfig.exclude)) return false;
    return true;
  });
}

async function pruneInvalidDepartmentMembers(guild, dept) {
  const syncConfig = CONFIG.syncRoles[dept];
  if (!syncConfig) return 0;

  let removedCount = 0;

  store.편제[dept] = store.편제[dept].filter((saved) => {
    const member = guild.members.cache.get(String(saved.id));
    if (!member) {
      removedCount += 1;
      return false;
    }

    if (!member.roles.cache.has(CONFIG.requiredSyncRole)) {
      removedCount += 1;
      return false;
    }

    if (!hasAllRoles(member, syncConfig.include)) {
      removedCount += 1;
      return false;
    }

    if (hasAnyRole(member, syncConfig.exclude)) {
      removedCount += 1;
      return false;
    }

    return true;
  });

  return removedCount;
}

async function syncDepartmentMembers(guild, dept) {
  const removedCount = await pruneInvalidDepartmentMembers(guild, dept);
  const targetMembers = [...getSyncTargetMembers(guild, dept).values()];

  let addedCount = 0;
  let updatedCount = 0;
  let failedCount = 0;

  for (const member of targetMembers) {
    try {
      const alreadyInSameDept = store.편제[dept].some(
        (saved) => String(saved.id) === String(member.id)
      );

      removeUserFromOrganization(member.id);

      store.편제[dept].push({
        id: String(member.id),
        nickname: sanitizeNickname(member.displayName) || member.displayName,
      });

      // 편제전체추가에서는 역할 변경 안 함

      if (alreadyInSameDept) {
        updatedCount += 1;
      } else {
        addedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      console.error(`${dept} 편제 전체추가 실패:`, member.id, error);
    }
  }

  await persistStore(guild);

  return {
    total: targetMembers.length,
    addedCount,
    updatedCount,
    failedCount,
    removedCount,
  };
}

async function handleBulkAddMajor({ interaction, guild, userLevel }) {
  if (userLevel < 1) {
    return replyError(interaction, "❌ Level 1 이상만 사용 가능합니다.");
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await syncDepartmentMembers(guild, "소령");

  return reply(interaction, {
    content:
      `✅ 소령 편제 전체추가 완료\n` +
      `대상: ${result.total}명\n` +
      `신규 추가: ${result.addedCount}명\n` +
      `기존 갱신: ${result.updatedCount}명\n` +
      `자동 제외: ${result.removedCount}명\n` +
      `실패: ${result.failedCount}명`,
    ephemeral: true,
  });
}

async function handleBulkAddLtColonel({ interaction, guild, userLevel }) {
  if (userLevel < 2) {
    return replyError(interaction, "❌ Level 2 이상만 사용 가능합니다.");
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await syncDepartmentMembers(guild, "중령");

  return reply(interaction, {
    content:
      `✅ 중령 편제 전체추가 완료\n` +
      `대상: ${result.total}명\n` +
      `신규 추가: ${result.addedCount}명\n` +
      `기존 갱신: ${result.updatedCount}명\n` +
      `자동 제외: ${result.removedCount}명\n` +
      `실패: ${result.failedCount}명`,
    ephemeral: true,
  });
}

async function handleBulkAddColonel({ interaction, guild, userLevel }) {
  if (userLevel < 2) {
    return replyError(interaction, "❌ Level 2 이상만 사용 가능합니다.");
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await syncDepartmentMembers(guild, "대령");

  return reply(interaction, {
    content:
      `✅ 대령 편제 전체추가 완료\n` +
      `대상: ${result.total}명\n` +
      `신규 추가: ${result.addedCount}명\n` +
      `기존 갱신: ${result.updatedCount}명\n` +
      `자동 제외: ${result.removedCount}명\n` +
      `실패: ${result.failedCount}명`,
    ephemeral: true,
  });
}

const commandHandlers = {
  편제추가: handleAddOrganizationMember,
  사령본부추가: handleAddHeadquartersMember,
  편제삭제: handleRemoveOrganizationMember,
  편제현황: handleShowOrganization,
  찾기: handleFindMember,
  공지: handleCreateNotice,
  공지수정: handleUpdateNotice,
  해임: handleDismissMember,
  소령편제전체추가: handleBulkAddMajor,
  중령편제전체추가: handleBulkAddLtColonel,
  대령편제전체추가: handleBulkAddColonel,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once("ready", async () => {
  console.log(`✅ 로그인 완료: ${client.user.tag}`);

  const guild = client.guilds.cache.get(CONFIG.guildId);
  if (!guild) return;

  try {
    await guild.members.fetch();
    console.log("✅ 길드 멤버 캐시 로드 완료");
  } catch (error) {
    console.warn("⚠️ 길드 멤버 전체 fetch 실패:", error?.message || error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guild) {
    return replyError(interaction, "❌ 길드에서만 사용 가능합니다.");
  }

  const handler = commandHandlers[interaction.commandName];
  if (!handler) return;

  const guild = interaction.guild;
  const executorMember = await fetchMember(guild, interaction.user.id);
  const userLevel = getUserLevel(executorMember);

  try {
    await handler({
      interaction,
      guild,
      userLevel,
    });
  } catch (error) {
    console.error("명령 처리 중 오류:", error);

    const message =
      "❌ 처리 중 오류가 발생했습니다. 봇 역할 위치, Manage Roles 권한, 환경변수를 확인해주세요.";

    await replyError(interaction, message);
  }
});

(async () => {
  try {
    await registerCommands();
    await client.login(CONFIG.token);
  } catch (error) {
    console.error("❌ 시작 실패:", error);
    process.exit(1);
  }
})();
