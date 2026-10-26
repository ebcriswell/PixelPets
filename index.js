require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');

const MENU_CHANNEL_ID = '1564308207596347402'; // ← paste your channel ID here

const db = new Database('pets.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    pet_name TEXT NOT NULL,
    species TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    hunger INTEGER DEFAULT 100,
    happiness INTEGER DEFAULT 100,
    energy INTEGER DEFAULT 100,
    is_active INTEGER DEFAULT 0
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    coins INTEGER DEFAULT 50,
    last_daily INTEGER DEFAULT 0
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS inventory (
    user_id TEXT,
    item_id TEXT,
    PRIMARY KEY (user_id, item_id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS equipped (
    user_id TEXT PRIMARY KEY,
    item_id TEXT
  )
`).run();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const ACCESSORIES = {
  tophat: { name: 'Top Hat', price: 50, emoji: '🎩' },
  scarf: { name: 'Cozy Scarf', price: 40, emoji: '🧣' },
  glasses: { name: 'Cool Glasses', price: 35, emoji: '🕶️' },
  bow: { name: 'Cute Bow', price: 30, emoji: '🎀' },
  crown: { name: 'Tiny Crown', price: 100, emoji: '👑' },
};

const PETS_FOR_SALE = {
  bunny: { name: 'Bunny', price: 150, emoji: '🐰' },
  cat: { name: 'Cat', price: 150, emoji: '🐱' },
  frog: { name: 'Frog', price: 150, emoji: '🐸' },
  fox: { name: 'Fox', price: 150, emoji: '🦊' },
};

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Pong!'),
  new SlashCommandBuilder().setName('menu').setDescription('Open the PixelPets menu'),
  new SlashCommandBuilder()
    .setName('adopt')
    .setDescription('Get your first free pet')
    .addStringOption(o => o.setName('species').setDescription('Species').setRequired(true)
      .addChoices(
        { name: 'Fox', value: 'fox' },
        { name: 'Bunny', value: 'bunny' },
        { name: 'Cat', value: 'cat' },
        { name: 'Frog', value: 'frog' }
      ))
    .addStringOption(o => o.setName('name').setDescription('Name').setRequired(true).setMaxLength(20)),
  new SlashCommandBuilder().setName('pet').setDescription('View your active pet'),
  new SlashCommandBuilder().setName('pets').setDescription('List all your pets'),
  new SlashCommandBuilder()
    .setName('switch')
    .setDescription('Switch active pet')
    .addIntegerOption(o => o.setName('id').setDescription('Pet ID').setRequired(true)),
  new SlashCommandBuilder().setName('feed').setDescription('Feed active pet'),
  new SlashCommandBuilder().setName('play').setDescription('Play with active pet'),
  new SlashCommandBuilder().setName('daily').setDescription('Daily reward'),
  new SlashCommandBuilder().setName('balance').setDescription('Check your coins'),
  new SlashCommandBuilder().setName('shop').setDescription('View shop'),
  new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy something')
    .addStringOption(o => o.setName('item').setDescription('Item').setRequired(true)
      .addChoices(
        { name: 'Top Hat', value: 'acc_tophat' },
        { name: 'Scarf', value: 'acc_scarf' },
        { name: 'Glasses', value: 'acc_glasses' },
        { name: 'Bow', value: 'acc_bow' },
        { name: 'Crown', value: 'acc_crown' },
        { name: 'Bunny', value: 'pet_bunny' },
        { name: 'Cat', value: 'pet_cat' },
        { name: 'Frog', value: 'pet_frog' },
        { name: 'Fox', value: 'pet_fox' }
      )),
  new SlashCommandBuilder().setName('inventory').setDescription('Your accessories'),
  new SlashCommandBuilder()
    .setName('equip')
    .setDescription('Equip accessory')
    .addStringOption(o => o.setName('item').setDescription('Item').setRequired(true)
      .addChoices(
        { name: 'Top Hat', value: 'tophat' },
        { name: 'Scarf', value: 'scarf' },
        { name: 'Glasses', value: 'glasses' },
        { name: 'Bow', value: 'bow' },
        { name: 'Crown', value: 'crown' },
        { name: 'None', value: 'none' }
      )),
].map(c => c.toJSON());

function getMenuRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('menu_pet').setLabel('View Pet').setStyle(ButtonStyle.Primary).setEmoji('🐾'),
    new ButtonBuilder().setCustomId('menu_feed').setLabel('Feed').setStyle(ButtonStyle.Success).setEmoji('🍖'),
    new ButtonBuilder().setCustomId('menu_play').setLabel('Play').setStyle(ButtonStyle.Success).setEmoji('🎾'),
    new ButtonBuilder().setCustomId('menu_shop').setLabel('Shop').setStyle(ButtonStyle.Secondary).setEmoji('🛍️'),
    new ButtonBuilder().setCustomId('menu_balance').setLabel('Balance').setStyle(ButtonStyle.Secondary).setEmoji('🪙')
  );
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Commands registered.');
  } catch (e) { console.error(e); }

  // Post permanent menu
  try {
    const channel = await client.channels.fetch(MENU_CHANNEL_ID);
    if (channel) {
      const messages = await channel.messages.fetch({ limit: 15 });
      const existing = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title?.includes('PixelPets Menu'));
      
      const embed = new EmbedBuilder()
        .setTitle('🐾 PixelPets Menu')
        .setDescription('Click the buttons below to interact with your pet!')
        .setColor(0xFFA500);
      
      if (existing) {
        await existing.edit({ embeds: [embed], components: [getMenuRow()] });
        console.log('Updated existing menu.');
      } else {
        await channel.send({ embeds: [embed], components: [getMenuRow()] });
        console.log('Posted new menu.');
      }
    }
  } catch (e) {
    console.error('Menu post failed:', e.message);
  }

  setInterval(() => {
    db.prepare(`UPDATE pets SET hunger = MAX(0, hunger - 5), happiness = MAX(0, happiness - 4), energy = MIN(100, energy + 8)`).run();
  }, 20 * 60 * 1000);
});

function getUser(id) {
  let u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(id);
  if (!u) {
    db.prepare('INSERT INTO users (user_id) VALUES (?)').run(id);
    u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(id);
  }
  return u;
}

function getActivePet(userId) {
  return db.prepare('SELECT * FROM pets WHERE user_id = ? AND is_active = 1').get(userId);
}

async function makeTransparent(imgPath) {
  const img = await loadImage(imgPath);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    if (d.data[i] > 210 && d.data[i+1] > 210 && d.data[i+2] > 210) d.data[i+3] = 0;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

async function generatePetGif(pet, equipped) {
  const encoder = new GIFEncoder(400, 400);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(120);
  encoder.setQuality(10);

  const canvas = createCanvas(400, 400);
  const ctx = canvas.getContext('2d');

  const folder = path.join(__dirname, 'assets', pet.species);
  const frames = [];
  if (fs.existsSync(folder)) {
    for (let i = 1; ; i++) {
      const p = path.join(folder, `frame${i}.jpg`);
      if (!fs.existsSync(p)) break;
      frames.push(await loadImage(p));
    }
  }
  if (frames.length === 0) {
    const p = path.join(__dirname, 'assets', `${pet.species}.jpg`);
    if (fs.existsSync(p)) frames.push(await loadImage(p));
  }

  let acc = null;
  if (equipped) {
    const p = path.join(__dirname, 'assets', `${equipped}.jpg`);
    if (fs.existsSync(p)) acc = await makeTransparent(p);
  }

  for (const f of frames) {
    ctx.clearRect(0, 0, 400, 400);
    ctx.drawImage(f, 0, 0, 400, 400);
    if (acc) ctx.drawImage(acc, 115, 20, 170, 170);
    encoder.addFrame(ctx);
  }
  if (frames.length < 2) for (let i = 0; i < 4; i++) encoder.addFrame(ctx);

  encoder.finish();
  return encoder.out.getData();
}

client.on('interactionCreate', async i => {
  const uid = i.user.id;
  const user = getUser(uid);

  if (i.isButton()) {
    try {
      if (i.customId === 'menu_pet') {
        const pet = getActivePet(uid);
        if (!pet) return i.reply({ content: 'No active pet. Use `/adopt` first.', ephemeral: true });
        const eq = db.prepare('SELECT item_id FROM equipped WHERE user_id = ?').get(uid);
        const buf = await generatePetGif(pet, eq?.item_id);
        const att = new AttachmentBuilder(buf, { name: 'pet.gif' });
        const embed = new EmbedBuilder()
          .setTitle(`${pet.pet_name} the ${pet.species}`)
          .setDescription(`Level ${pet.level} • ${pet.xp} XP`)
          .addFields(
            { name: 'Hunger', value: `${pet.hunger}`, inline: true },
            { name: 'Happiness', value: `${pet.happiness}`, inline: true },
            { name: 'Energy', value: `${pet.energy}`, inline: true },
            { name: 'Coins', value: `${user.coins}`, inline: true }
          )
          .setImage('attachment://pet.gif');
        return i.reply({ embeds: [embed], files: [att], ephemeral: true });
      }

      if (i.customId === 'menu_feed') {
        const pet = getActivePet(uid);
        if (!pet) return i.reply({ content: 'No active pet.', ephemeral: true });
        db.prepare('UPDATE pets SET hunger = MIN(100, hunger+25), xp = xp+5 WHERE id = ?').run(pet.id);
        db.prepare('UPDATE users SET coins = coins+3 WHERE user_id = ?').run(uid);
        return i.reply({ content: `Fed **${pet.pet_name}**!`, ephemeral: true });
      }

      if (i.customId === 'menu_play') {
        const pet = getActivePet(uid);
        if (!pet) return i.reply({ content: 'No active pet.', ephemeral: true });
        if (pet.energy < 10) return i.reply({ content: 'Too tired to play.', ephemeral: true });
        db.prepare('UPDATE pets SET happiness = MIN(100, happiness+20), energy = MAX(0, energy-15), xp = xp+8 WHERE id = ?').run(pet.id);
        db.prepare('UPDATE users SET coins = coins+4 WHERE user_id = ?').run(uid);
        return i.reply({ content: `Played with **${pet.pet_name}**!`, ephemeral: true });
      }

      if (i.customId === 'menu_shop') {
        const e = new EmbedBuilder().setTitle('🛍️ Shop').setColor(0xFFA500);
        e.addFields({ name: 'Accessories', value: Object.entries(ACCESSORIES).map(([k,v]) => `${v.emoji} ${v.name} — ${v.price} coins`).join('\n') });
        e.addFields({ name: 'Pets', value: Object.entries(PETS_FOR_SALE).map(([k,v]) => `${v.emoji} ${v.name} — ${v.price} coins`).join('\n') });
        return i.reply({ embeds: [e], ephemeral: true });
      }

      if (i.customId === 'menu_balance') {
        return i.reply({ content: `You have **${user.coins}** coins 🪙`, ephemeral: true });
      }
    } catch (err) {
      console.error(err);
      if (!i.replied) i.reply({ content: 'Something went wrong.', ephemeral: true });
    }
    return;
  }

  if (!i.isChatInputCommand()) return;

  try {
    if (i.commandName === 'ping') return i.reply('Pong!');

    if (i.commandName === 'menu') {
      const embed = new EmbedBuilder()
        .setTitle('🐾 PixelPets Menu')
        .setDescription('Click the buttons below!')
        .setColor(0xFFA500);
      return i.reply({ embeds: [embed], components: [getMenuRow()] });
    }

    if (i.commandName === 'adopt') {
      const count = db.prepare('SELECT COUNT(*) as c FROM pets WHERE user_id = ?').get(uid).c;
      if (count > 0) return i.reply({ content: 'You already have a pet. Buy more from the shop.', ephemeral: true });
      const species = i.options.getString('species');
      const name = i.options.getString('name');
      db.prepare('INSERT INTO pets (user_id, pet_name, species, is_active) VALUES (?, ?, ?, 1)').run(uid, name, species);
      return i.reply(`🎉 Adopted **${name}** the ${species}!`);
    }

    if (i.commandName === 'pets') {
      const pets = db.prepare('SELECT * FROM pets WHERE user_id = ?').all(uid);
      if (!pets.length) return i.reply({ content: 'No pets yet.', ephemeral: true });
      const txt = pets.map(p => `${p.is_active ? '⭐' : '•'} **${p.pet_name}** (${p.species}) — ID ${p.id}`).join('\n');
      return i.reply(`**Your Pets**\n${txt}`);
    }

    if (i.commandName === 'switch') {
      const id = i.options.getInteger('id');
      const pet = db.prepare('SELECT * FROM pets WHERE id = ? AND user_id = ?').get(id, uid);
      if (!pet) return i.reply({ content: 'Invalid ID.', ephemeral: true });
      db.prepare('UPDATE pets SET is_active = 0 WHERE user_id = ?').run(uid);
      db.prepare('UPDATE pets SET is_active = 1 WHERE id = ?').run(id);
      return i.reply(`Switched to **${pet.pet_name}**.`);
    }

    if (i.commandName === 'balance') {
      return i.reply(`You have **${user.coins}** coins 🪙`);
    }

    async function showPet(extra = '') {
      const pet = getActivePet(uid);
      if (!pet) return i.reply({ content: 'No active pet.', ephemeral: true });
      const eq = db.prepare('SELECT item_id FROM equipped WHERE user_id = ?').get(uid);
      const buf = await generatePetGif(pet, eq?.item_id);
      const att = new AttachmentBuilder(buf, { name: 'pet.gif' });
      const embed = new EmbedBuilder()
        .setTitle(`${pet.pet_name} the ${pet.species}`)
        .setDescription(`Level ${pet.level} • ${pet.xp} XP`)
        .addFields(
          { name: 'Hunger', value: `${pet.hunger}`, inline: true },
          { name: 'Happiness', value: `${pet.happiness}`, inline: true },
          { name: 'Energy', value: `${pet.energy}`, inline: true },
          { name: 'Coins', value: `${user.coins}`, inline: true }
        )
        .setImage('attachment://pet.gif')
        .setFooter({ text: `ID ${pet.id}` });
      return i.reply({ content: extra || null, embeds: [embed], files: [att] });
    }

    if (i.commandName === 'pet') return showPet();

    if (i.commandName === 'feed') {
      const pet = getActivePet(uid);
      if (!pet) return i.reply({ content: 'No active pet.', ephemeral: true });
      db.prepare('UPDATE pets SET hunger = MIN(100, hunger+25), xp = xp+5 WHERE id = ?').run(pet.id);
      db.prepare('UPDATE users SET coins = coins+3 WHERE user_id = ?').run(uid);
      return showPet(`Fed **${pet.pet_name}**!`);
    }

    if (i.commandName === 'play') {
      const pet = getActivePet(uid);
      if (!pet) return i.reply({ content: 'No active pet.', ephemeral: true });
      if (pet.energy < 10) return i.reply({ content: 'Too tired.', ephemeral: true });
      db.prepare('UPDATE pets SET happiness = MIN(100, happiness+20), energy = MAX(0, energy-15), xp = xp+8 WHERE id = ?').run(pet.id);
      db.prepare('UPDATE users SET coins = coins+4 WHERE user_id = ?').run(uid);
      return showPet(`Played with **${pet.pet_name}**!`);
    }

    if (i.commandName === 'daily') {
      const now = Date.now();
      if (now - user.last_daily < 86400000) return i.reply({ content: 'Already claimed.', ephemeral: true });
      const coins = 30 + Math.floor(Math.random()*20);
      db.prepare('UPDATE users SET coins = coins+?, last_daily = ? WHERE user_id = ?').run(coins, now, uid);
      const pet = getActivePet(uid);
      if (pet) db.prepare('UPDATE pets SET xp = xp+10 WHERE id = ?').run(pet.id);
      return showPet(`Daily: +${coins} coins!`);
    }

    if (i.commandName === 'shop') {
      const e = new EmbedBuilder().setTitle('Shop').setColor(0xFFA500);
      e.addFields({ name: 'Accessories', value: Object.entries(ACCESSORIES).map(([k,v]) => `${v.emoji} ${v.name} — ${v.price}`).join('\n') });
      e.addFields({ name: 'Pets', value: Object.entries(PETS_FOR_SALE).map(([k,v]) => `${v.emoji} ${v.name} — ${v.price}`).join('\n') });
      return i.reply({ embeds: [e] });
    }

    if (i.commandName === 'buy') {
      const key = i.options.getString('item');
      if (key.startsWith('pet_')) {
        const species = key.slice(4);
        const price = PETS_FOR_SALE[species].price;
        if (user.coins < price) return i.reply({ content: 'Not enough coins.', ephemeral: true });
        db.prepare('UPDATE users SET coins = coins - ? WHERE user_id = ?').run(price, uid);
        db.prepare('INSERT INTO pets (user_id, pet_name, species, is_active) VALUES (?, ?, ?, 0)').run(uid, PETS_FOR_SALE[species].name, species);
        return i.reply(`Bought a **${PETS_FOR_SALE[species].name}**!`);
      } else {
        const acc = key.slice(4);
        const price = ACCESSORIES[acc].price;
        if (user.coins < price) return i.reply({ content: 'Not enough coins.', ephemeral: true });
        if (db.prepare('SELECT 1 FROM inventory WHERE user_id = ? AND item_id = ?').get(uid, acc)) {
          return i.reply({ content: 'Already own it.', ephemeral: true });
        }
        db.prepare('UPDATE users SET coins = coins - ? WHERE user_id = ?').run(price, uid);
        db.prepare('INSERT INTO inventory (user_id, item_id) VALUES (?, ?)').run(uid, acc);
        return i.reply(`Bought **${ACCESSORIES[acc].name}**!`);
      }
    }

    if (i.commandName === 'inventory') {
      const items = db.prepare('SELECT item_id FROM inventory WHERE user_id = ?').all(uid);
      if (!items.length) return i.reply({ content: 'Inventory empty.', ephemeral: true });
      const list = items.map(x => ACCESSORIES[x.item_id] ? `${ACCESSORIES[x.item_id].emoji} ${ACCESSORIES[x.item_id].name}` : x.item_id).join('\n');
      return i.reply(`**Accessories:**\n${list}`);
    }

    if (i.commandName === 'equip') {
      const item = i.options.getString('item');
      if (item === 'none') {
        db.prepare('DELETE FROM equipped WHERE user_id = ?').run(uid);
        return i.reply('Unequipped.');
      }
      if (!db.prepare('SELECT 1 FROM inventory WHERE user_id = ? AND item_id = ?').get(uid, item)) {
        return i.reply({ content: "You don't own that.", ephemeral: true });
      }
      db.prepare('INSERT OR REPLACE INTO equipped (user_id, item_id) VALUES (?, ?)').run(uid, item);
      return i.reply(`Equipped **${ACCESSORIES[item].name}**.`);
    }
  } catch (err) {
    console.error(err);
    if (!i.replied && !i.deferred) i.reply({ content: 'Error.', ephemeral: true });
  }
});

client.login(process.env.TOKEN);