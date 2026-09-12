/**
 * ProfilePage.js — "My Profile": the one place a signed-in user sees and edits their own details.
 *
 * Route: /account/profile (alias: /profile). Reached from the TopBar avatar menu, which is
 * role-agnostic — a Super Admin, a Supplier and a Customer all land on this same page, because a
 * profile is an attribute of the person, not of the role they happen to be wearing.
 *
 * Backed by GET/PUT /api/v1/me/profile. The server owns validation (profile.service.js); this page
 * validates only what it can answer without a round trip, so a typo is caught before the request
 * and everything else surfaces as a field error from the API response's `details.field`.
 *
 * Two writes deliberately reach past the form:
 *  - Saving a new language also calls setLanguage(), and a new numeral preference also calls
 *    setNumeralPreference(). Both are stored server-side AND applied to the live session, because
 *    a preference that only takes effect on next login reads as a bug.
 */

import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Switch } from '../../components/ui/Switch.js';
import { Badge } from '../../components/ui/Badge.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { api, pickMessage } from '../../core/api.js';
import {
  t,
  getLanguage,
  setLanguage,
  getEnabledLanguages,
  isLanguageSwitchAllowed,
} from '../../services/i18n.js';
import { formatDate, formatPhone, setNumeralPreference } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { bindBackControl } from '../../core/navBack.js';
import {
  BANGLADESH_DIVISIONS,
  getDistrictsByDivision,
  getUpazilasByDistrict,
} from '../../data/bangladeshGeo.js';

// Matches media.service.js's avatar ceiling. Checked here so an oversized pick fails instantly
// instead of after uploading megabytes the server will reject anyway.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

const GENDERS = ['UNSPECIFIED', 'MALE', 'FEMALE', 'OTHER'];

// A short, honest list rather than the full IANA database: this product ships in Bangladesh, and
// the diaspora entries below cover where its users actually are.
const TIMEZONES = [
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kuala_Lumpur',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
];

const ROLE_LABEL_KEYS = {
  super_admin: 'shell.role_names.super_admin',
  admin: 'shell.role_names.admin',
  moderator: 'shell.role_names.moderator',
  editor: 'shell.role_names.editor',
  supplier: 'shell.role_names.supplier',
  saler: 'shell.role_names.saler',
  customer: 'shell.role_names.customer',
};

/** Up to two initials from a name, in whatever script the name is written in. */
export function initialsFor(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Reads a File into a `data:` URL — the shape POST /media/direct accepts as `data_base64`. */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

export default function ProfilePage(root, { navigate } = {}) {
  const nav = (url, opts = {}) => {
    if (typeof navigate === 'function') navigate(url, opts);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  /** The last profile the server confirmed. Reset restores exactly this. */
  let saved = null;
  /** Pending avatar chosen but not yet saved — `{ id, url }` or null once cleared. */
  let pendingAvatar = undefined;

  const container = document.createElement('div');
  container.className = 'account-page profile-page';

  const header = document.createElement('div');
  header.className = 'account-page__header';
  header.innerHTML = `
    <a href="/account" class="account-page__back account-page__back--boxed">
      ← ${t('common.back', 'Back')} · ${t('profile.breadcrumb', 'My Account')}
    </a>
    <h1 class="account-page__title">${t('profile.page_title', 'My Profile')}</h1>
    <p class="account-page__subtitle">
      ${t('profile.page_subtitle', 'Your name, contact details, location and language preferences — everything Explooro knows about you.')}
    </p>
  `;
  container.append(header);
  bindBackControl(header.querySelector('.account-page__back'), nav, '/account');

  const body = document.createElement('div');
  body.className = 'profile-page__body';
  container.append(body);

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------

  function showSkeleton() {
    body.replaceChildren();
    const hero = document.createElement('div');
    hero.className = 'profile-hero profile-hero--loading';
    hero.append(Skeleton({ variant: 'block', height: 96 }), Skeleton({ variant: 'text', lines: 3 }));
    body.append(hero);
    const grid = document.createElement('div');
    grid.className = 'profile-grid';
    for (let i = 0; i < 4; i += 1) {
      const shell = document.createElement('div');
      shell.className = 'account-page__card-loading';
      shell.append(Skeleton({ variant: 'text', lines: 2 }), Skeleton({ variant: 'block', height: 132 }));
      grid.append(shell);
    }
    body.append(grid);
  }

  function showError(message, onRetry) {
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = 'account-page__error';
    box.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = message;
    box.append(text, Button({ label: t('common.retry', 'Retry'), variant: 'secondary', size: 'sm', onClick: onRetry }));
    body.append(box);
  }

  // ---------------------------------------------------------------------------
  // Identity hero — avatar, name, roles, account facts
  // ---------------------------------------------------------------------------

  function currentAvatarUrl() {
    if (pendingAvatar !== undefined) return pendingAvatar?.url ?? null;
    return saved.avatar_url;
  }

  function currentAvatarId() {
    if (pendingAvatar !== undefined) return pendingAvatar?.id ?? null;
    return saved.avatar_media_id;
  }

  function buildAvatar() {
    const wrap = document.createElement('div');
    wrap.className = 'profile-avatar';

    const url = currentAvatarUrl();
    if (url) {
      const img = document.createElement('img');
      img.className = 'profile-avatar__img';
      img.src = url;
      img.alt = t('profile.avatar_alt', 'Your profile picture');
      wrap.append(img);
    } else {
      const initials = document.createElement('span');
      initials.className = 'profile-avatar__initials';
      initials.setAttribute('aria-hidden', 'true');
      initials.textContent = initialsFor(saved.display_name || saved.full_name);
      wrap.append(initials);
      // The visual is initials, but the accessible name has to say whose profile this is.
      wrap.setAttribute('role', 'img');
      wrap.setAttribute('aria-label', t('profile.avatar_placeholder_alt', 'No profile picture set'));
    }
    return wrap;
  }

  /** Hidden file input + the two buttons that drive it. */
  function buildAvatarControls(rerenderHero) {
    const controls = document.createElement('div');
    controls.className = 'profile-avatar-controls';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = ACCEPTED_AVATAR_TYPES.join(',');
    fileInput.className = 'profile-avatar-controls__file';
    fileInput.hidden = true;
    // Not a label the user reads, but the one a screen reader announces when focus lands here.
    fileInput.setAttribute('aria-label', t('profile.change_photo', 'Change photo'));

    const chooseBtn = Button({
      label: t('profile.change_photo', 'Change photo'),
      variant: 'secondary',
      size: 'sm',
      onClick: () => fileInput.click(),
    });

    const removeBtn = Button({
      label: t('profile.remove_photo', 'Remove photo'),
      variant: 'ghost',
      size: 'sm',
      onClick: () => {
        pendingAvatar = null;
        rerenderHero();
        markDirty();
      },
    });
    removeBtn.hidden = !currentAvatarUrl();

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      // Reset immediately so re-picking the same file still fires `change`.
      fileInput.value = '';
      if (!file) return;

      if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
        toast.error(t('profile.avatar_type_error', 'Choose a JPEG, PNG, WebP or AVIF image.'));
        return;
      }
      if (file.size > MAX_AVATAR_BYTES) {
        toast.error(t('profile.avatar_size_error', 'Profile pictures must be 2 MB or smaller.'));
        return;
      }

      chooseBtn.setLoading(true);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const res = await api.post('/media/direct', {
          purpose: 'AVATAR',
          filename: file.name,
          data_base64: dataUrl,
        });
        const asset = res?.asset || res?.data?.asset;
        if (!asset?.id) throw new Error('upload_failed');
        pendingAvatar = { id: asset.id, url: asset.url || dataUrl };
        rerenderHero();
        markDirty();
        toast.success(t('profile.avatar_ready', 'Photo ready — save to apply it.'));
      } catch (err) {
        toast.error(err?.code ? pickMessage(err) : t('profile.avatar_upload_failed', 'Could not upload that image.'));
      } finally {
        chooseBtn.setLoading(false);
      }
    });

    controls.append(chooseBtn, removeBtn, fileInput);
    return controls;
  }

  function buildHero() {
    const hero = document.createElement('section');
    hero.className = 'profile-hero';
    hero.setAttribute('aria-label', t('profile.identity_heading', 'Identity'));

    const rerender = () => {
      const fresh = buildHero();
      hero.replaceWith(fresh);
    };

    const media = document.createElement('div');
    media.className = 'profile-hero__media';
    media.append(buildAvatar(), buildAvatarControls(rerender));

    const identity = document.createElement('div');
    identity.className = 'profile-hero__identity';

    const nameRow = document.createElement('div');
    nameRow.className = 'profile-hero__name-row';
    const name = document.createElement('h2');
    name.className = 'profile-hero__name';
    name.textContent = saved.display_name || saved.full_name || t('profile.unnamed', 'Unnamed account');
    nameRow.append(name);
    if (saved.status === 'ACTIVE') {
      nameRow.append(Badge({ variant: 'status', status: 'open', label: t('profile.status_active', 'Active'), size: 'sm' }));
    } else {
      nameRow.append(Badge({ variant: 'status', status: 'closed', label: t(`profile.status_${String(saved.status).toLowerCase()}`, saved.status), size: 'sm' }));
    }
    identity.append(nameRow);

    const roles = document.createElement('div');
    roles.className = 'profile-hero__roles';
    (saved.roles?.length ? saved.roles : ['customer']).forEach((role) => {
      const key = typeof role === 'string' ? role : role?.key;
      roles.append(Badge({ variant: 'brand', label: t(ROLE_LABEL_KEYS[key] || `shell.role_names.${key}`, key), size: 'sm' }));
    });
    identity.append(roles);

    const facts = document.createElement('dl');
    facts.className = 'profile-hero__facts';
    const lang = getLanguage();
    const rows = [
      [t('profile.fact_ref', 'Account ID'), saved.ref],
      [t('profile.fact_member_since', 'Member since'), saved.created_at ? formatDate(saved.created_at, { lang }) : '—'],
      [
        t('profile.fact_last_login', 'Last sign-in'),
        saved.last_login_at ? formatDate(saved.last_login_at, { lang, timeStyle: 'short' }) : '—',
      ],
    ];
    rows.forEach(([label, value]) => {
      // Each label/value pair is wrapped so the grid lays out PAIRS, not alternating dt and dd
      // cells — an auto-fit grid over bare dl children interleaves them into nonsense columns.
      const pair = document.createElement('div');
      pair.className = 'profile-hero__fact';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value || '—';
      pair.append(dt, dd);
      facts.append(pair);
    });
    identity.append(facts);

    hero.append(media, identity);
    return hero;
  }

  // ---------------------------------------------------------------------------
  // Form fields
  // ---------------------------------------------------------------------------

  /** Every editable control, keyed by the API field it writes. */
  const fields = {};
  let actionsBar = null;
  let saveBtn = null;
  let resetBtn = null;

  function markDirty() {
    if (!actionsBar) return;
    actionsBar.dataset.dirty = 'true';
    const msg = actionsBar.querySelector('.profile-actions__msg');
    if (msg) msg.textContent = t('profile.unsaved_changes', 'You have unsaved changes');
    if (resetBtn) resetBtn.setDisabled(false);
  }

  function clearFieldErrors() {
    Object.values(fields).forEach((field) => field?.setError?.(''));
  }

  function labelledSection(titleKey, titleFallback, subtitleKey, subtitleFallback, rows) {
    const grid = document.createElement('div');
    grid.className = 'profile-card__grid';
    rows.forEach((row) => grid.append(row));

    const card = Card({
      title: t(titleKey, titleFallback),
      subtitle: t(subtitleKey, subtitleFallback),
      body: grid,
    });
    card.classList.add('profile-card');
    return card;
  }

  function buildPersonalCard() {
    fields.full_name = Input({
      label: t('profile.field_full_name', 'Full name'),
      hint: t('profile.hint_full_name', 'As it appears on your NID or passport.'),
      value: saved.full_name || '',
      required: true,
      maxLength: 120,
      autocomplete: 'name',
      onInput: markDirty,
    });

    fields.display_name = Input({
      label: t('profile.field_display_name', 'Display name'),
      hint: t('profile.hint_display_name', 'Shown to other people on Explooro. Leave blank to use your full name.'),
      value: saved.display_name === saved.full_name ? '' : saved.display_name || '',
      placeholder: saved.full_name || '',
      maxLength: 60,
      onInput: markDirty,
    });

    fields.gender = Select({
      label: t('profile.field_gender', 'Gender'),
      value: saved.gender || 'UNSPECIFIED',
      options: GENDERS.map((g) => ({ value: g, label: t(`profile.gender_${g.toLowerCase()}`, g) })),
      onChange: markDirty,
    });

    fields.date_of_birth = Input({
      label: t('profile.field_dob', 'Date of birth'),
      hint: t('profile.hint_dob', 'Kept private. Used only for age-restricted offers.'),
      type: 'date',
      value: saved.date_of_birth || '',
      onChange: markDirty,
    });

    fields.bio = Textarea({
      label: t('profile.field_bio', 'About you'),
      hint: t('profile.hint_bio', 'A short introduction shown on your public storefront, if you have one.'),
      value: saved.bio || '',
      rows: 3,
      maxLength: 500,
      showCounter: true,
      autoResize: true,
      onInput: markDirty,
    });
    fields.bio.classList.add('profile-card__field--wide');

    return labelledSection(
      'profile.section_personal',
      'Personal details',
      'profile.section_personal_desc',
      'Who you are. Your full name is required; everything else is optional.',
      [fields.full_name, fields.display_name, fields.gender, fields.date_of_birth, fields.bio]
    );
  }

  function verificationBadge(verified) {
    const wrap = document.createElement('span');
    wrap.className = 'profile-verify';
    wrap.append(
      verified
        ? Badge({ variant: 'verified', label: t('profile.verified', 'Verified'), size: 'sm' })
        : Badge({ variant: 'warning', label: t('profile.unverified', 'Not verified'), size: 'sm' })
    );
    return wrap;
  }

  function buildContactCard() {
    // Phone is the login identifier — read-only here, changed only through the OTP flow.
    fields.phone = Input({
      label: t('profile.field_phone', 'Mobile number'),
      hint: t('profile.hint_phone', 'This is your sign-in number. Contact support to change it.'),
      value: formatPhone(saved.phone || ''),
      readonly: true,
      disabled: true,
    });
    fields.phone.classList.add('profile-card__field--wide', 'profile-field--with-badge');
    const phoneLabel = fields.phone.querySelector('.field__label');
    if (phoneLabel) {
      phoneLabel.append(verificationBadge(saved.is_phone_verified));
    } else {
      fields.phone.append(verificationBadge(saved.is_phone_verified));
    }

    fields.email = Input({
      label: t('profile.field_email', 'Email address'),
      hint: t('profile.hint_email', 'Changing your email means verifying the new one before receipts resume.'),
      type: 'email',
      value: saved.email || '',
      maxLength: 160,
      autocomplete: 'email',
      onInput: markDirty,
    });
    fields.email.classList.add('profile-card__field--wide', 'profile-field--with-badge');
    const emailLabel = fields.email.querySelector('.field__label');
    if (emailLabel) {
      emailLabel.append(verificationBadge(saved.is_email_verified));
    } else {
      fields.email.append(verificationBadge(saved.is_email_verified));
    }

    return labelledSection(
      'profile.section_contact',
      'Contact & verification',
      'profile.section_contact_desc',
      'How Explooro reaches you about orders, payouts and security.',
      [fields.phone, fields.email]
    );
  }

  function buildLocationCard() {
    const divisionOptions = BANGLADESH_DIVISIONS.map((d) => ({
      value: d.id,
      label: getLanguage() === 'bn' ? d.name_bn : d.name_en,
    }));

    fields.division = Select({
      label: t('profile.field_division', 'Division'),
      placeholder: t('profile.select_division', 'Select a division'),
      value: saved.division || '',
      options: divisionOptions,
      onChange: () => {
        // A district from the previous division would be a nonsense pair, so both dependents reset.
        syncDistricts('');
        syncUpazilas('');
        markDirty();
      },
    });

    fields.district = Select({
      label: t('profile.field_district', 'District'),
      placeholder: t('profile.select_district', 'Select a district'),
      value: saved.district || '',
      options: [],
      onChange: () => {
        syncUpazilas('');
        markDirty();
      },
    });

    fields.upazila = Select({
      label: t('profile.field_upazila', 'Upazila / Thana'),
      placeholder: t('profile.select_upazila', 'Select an upazila'),
      value: saved.upazila || '',
      options: [],
      onChange: markDirty,
    });

    fields.postal_code = Input({
      label: t('profile.field_postal', 'Postal code'),
      value: saved.postal_code || '',
      maxLength: 4,
      inputmode: 'numeric',
      autocomplete: 'postal-code',
      onInput: markDirty,
    });

    fields.address_line = Input({
      label: t('profile.field_address', 'Address'),
      hint: t('profile.hint_address', 'House and road. Delivery addresses live in your address book.'),
      value: saved.address_line || '',
      maxLength: 255,
      autocomplete: 'street-address',
      onInput: markDirty,
    });
    fields.address_line.classList.add('profile-card__field--wide');

    const addressBookLink = document.createElement('button');
    addressBookLink.type = 'button';
    addressBookLink.className = 'profile-inline-link';
    addressBookLink.textContent = t('profile.manage_addresses', 'Manage delivery addresses');
    addressBookLink.addEventListener('click', () => nav('/account/addresses'));

    const linkRow = document.createElement('div');
    linkRow.className = 'profile-card__field--wide profile-location-link-row';
    linkRow.append(addressBookLink);

    const card = labelledSection(
      'profile.section_location',
      'Location',
      'profile.section_location_desc',
      'Where you are, so Explooro can show relevant sellers and delivery estimates.',
      [fields.division, fields.district, fields.upazila, fields.postal_code, fields.address_line, linkRow]
    );

    // Populated after the selects exist, so the saved division/district resolve their children.
    syncDistricts(saved.district || '');
    syncUpazilas(saved.upazila || '');
    return card;
  }

  /** Refills the district select from the chosen division, preserving `keep` when still valid. */
  function syncDistricts(keep) {
    const select = fields.district?.input;
    if (!select) return;
    const division = fields.division?.value || '';
    const districts = division ? getDistrictsByDivision(division) : [];
    const lang = getLanguage();

    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('profile.select_district', 'Select a district');
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);

    districts.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = lang === 'bn' ? d.name_bn : d.name_en;
      if (d.id === keep) opt.selected = true;
      select.append(opt);
    });
    select.disabled = districts.length === 0;
  }

  function syncUpazilas(keep) {
    const select = fields.upazila?.input;
    if (!select) return;
    const division = fields.division?.value || '';
    const district = fields.district?.value || '';
    const upazilas = division && district ? getUpazilasByDistrict(division, district) : [];

    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('profile.select_upazila', 'Select an upazila');
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);

    upazilas.forEach((name) => {
      const opt = document.createElement('option');
      const value = typeof name === 'string' ? name : name.name_en;
      opt.value = value;
      opt.textContent = typeof name === 'string' ? name : (getLanguage() === 'bn' ? name.name_bn : name.name_en);
      if (value === keep) opt.selected = true;
      select.append(opt);
    });
    select.disabled = upazilas.length === 0;
  }

  function buildPreferencesCard() {
    // Only the locales the platform currently enables, and only while it lets visitors choose:
    // an option the policy would refuse is worse than no option, because saving it looks like it
    // worked (see isLanguageSwitchAllowed in services/i18n.js).
    const localeChoiceAllowed = isLanguageSwitchAllowed();
    const localeLabels = { en: t('language.name_en', 'English'), bn: t('language.name_bn', 'বাংলা') };
    fields.locale = Select({
      label: t('profile.field_language', 'Language'),
      hint: localeChoiceAllowed
        ? t('profile.hint_language', 'Applies everywhere, on every device you sign in from.')
        : t('profile.hint_language_locked', 'Your administrator has fixed the language for everyone on this platform.'),
      value: saved.locale || getLanguage(),
      options: getEnabledLanguages().map((code) => ({ value: code, label: localeLabels[code] || code })),
      disabled: !localeChoiceAllowed,
      onChange: markDirty,
    });

    fields.ui_mode = Select({
      label: t('profile.field_ui_mode', 'Interface mode'),
      hint: t('profile.hint_ui_mode', 'Simple hides advanced tools until you need them.'),
      value: saved.ui_mode || 'simple',
      options: [
        { value: 'simple', label: t('shell.mode.simple', 'Simple') },
        { value: 'advanced', label: t('shell.mode.advanced', 'Advanced') },
      ],
      onChange: markDirty,
    });

    fields.timezone = Select({
      label: t('profile.field_timezone', 'Time zone'),
      value: saved.timezone || 'Asia/Dhaka',
      options: TIMEZONES.map((tz) => ({ value: tz, label: tz.replace(/_/g, ' ') })),
      onChange: markDirty,
    });
    fields.timezone.classList.add('profile-card__field--wide');

    fields.use_bengali_numerals = Switch({
      label: t('profile.field_bengali_numerals', 'Use Bengali numerals'),
      hint: t('profile.hint_bengali_numerals', 'Show ১২৩ instead of 123 for prices and counts.'),
      checked: Boolean(saved.use_bengali_numerals),
      onChange: markDirty,
    });
    fields.use_bengali_numerals.classList.add('profile-card__field--wide');

    return labelledSection(
      'profile.section_preferences',
      'Preferences',
      'profile.section_preferences_desc',
      'How Explooro looks and reads for you.',
      [fields.locale, fields.ui_mode, fields.timezone, fields.use_bengali_numerals]
    );
  }

  /** Shortcuts to the settings surfaces that are not part of the profile record itself. */
  function buildRelatedCard() {
    const list = document.createElement('div');
    list.className = 'profile-links';

    const links = [
      { path: '/account/settings', label: t('profile.link_notifications', 'Notification preferences'), desc: t('profile.link_notifications_desc', 'Channels and quiet hours.') },
      { path: '/account/addresses', label: t('profile.link_addresses', 'Delivery addresses'), desc: t('profile.link_addresses_desc', 'Your saved address book.') },
      { path: '/account/kyc', label: t('profile.link_kyc', 'Identity verification'), desc: t('profile.link_kyc_desc', 'Submit NID or trade licence documents.') },
      { path: '/account/orders', label: t('profile.link_orders', 'Orders & tracking'), desc: t('profile.link_orders_desc', 'Everything you have bought.') },
    ];

    links.forEach((link) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'profile-links__item';
      item.innerHTML = `
        <div class="profile-links__content">
          <span class="profile-links__label"></span>
          <span class="profile-links__desc"></span>
        </div>
        <span class="profile-links__arrow" aria-hidden="true">→</span>
      `;
      item.querySelector('.profile-links__label').textContent = link.label;
      item.querySelector('.profile-links__desc').textContent = link.desc;
      item.addEventListener('click', () => nav(link.path));
      list.append(item);
    });

    const card = Card({
      title: t('profile.section_related', 'Related settings'),
      subtitle: t('profile.section_related_desc', 'Things that live outside your profile record.'),
      body: list,
    });
    card.classList.add('profile-card', 'profile-card--links');
    return card;
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  function collectPayload() {
    const payload = {
      full_name: fields.full_name.value,
      display_name: fields.display_name.value,
      gender: fields.gender.value || null,
      date_of_birth: fields.date_of_birth.value || null,
      email: fields.email.value.trim() || null,
      division: fields.division.value || null,
      district: fields.district.value || null,
      upazila: fields.upazila.value || null,
      address_line: fields.address_line.value || null,
      postal_code: fields.postal_code.value || null,
      bio: fields.bio.value || null,
      timezone: fields.timezone.value || 'Asia/Dhaka',
      locale: fields.locale.value,
      ui_mode: fields.ui_mode.value,
      use_bengali_numerals: fields.use_bengali_numerals.checked,
    };

    // WHY the key is ADDED rather than set to undefined: the mock driver hands the payload object
    // straight to its handler (core/api.js performMock), where `'avatar_media_id' in payload` is
    // true even for an undefined value — so an untouched avatar was being cleared in dev while
    // live mode, which JSON.stringify's the body and drops undefined keys, kept it. Omitting the
    // key entirely means "unchanged" on both paths; `null` still means "remove my photo".
    if (pendingAvatar !== undefined) payload.avatar_media_id = currentAvatarId();

    return payload;
  }

  /** The checks that need no round trip. Returns true when the form may be submitted. */
  function validateLocally() {
    clearFieldErrors();
    let firstInvalid = null;

    if (!fields.full_name.value.trim()) {
      fields.full_name.setError(t('profile.error_full_name', 'Your full name is required.'));
      firstInvalid = firstInvalid || fields.full_name;
    }

    const email = fields.email.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      fields.email.setError(t('profile.error_email', 'Enter a valid email address.'));
      firstInvalid = firstInvalid || fields.email;
    }

    const postal = fields.postal_code.value.trim();
    if (postal && !/^\d{4}$/.test(postal)) {
      fields.postal_code.setError(t('profile.error_postal', 'A Bangladeshi postal code is 4 digits.'));
      firstInvalid = firstInvalid || fields.postal_code;
    }

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  async function save() {
    if (!validateLocally()) return;

    saveBtn.setLoading(true);
    try {
      const res = await api.put('/me/profile', collectPayload());
      const next = res?.data || res;

      const languageChanged = next.locale && next.locale !== getLanguage();
      const numeralsChanged = Boolean(next.use_bengali_numerals) !== Boolean(saved.use_bengali_numerals);

      saved = next;
      pendingAvatar = undefined;

      // Applied to the live session, not just stored — see the file header.
      setNumeralPreference(next.use_bengali_numerals ? 'bengali' : 'latin');
      toast.success(t('profile.saved', 'Profile updated.'));

      if (languageChanged) {
        // setLanguage() re-renders subscribed nodes; render() below rebuilds this page either way.
        await setLanguage(next.locale);
      }
      render();
      if (numeralsChanged && !languageChanged) render();
    } catch (err) {
      const field = err?.details?.field;
      if (field && fields[field]) {
        fields[field].setError(pickMessage(err));
        fields[field].focus();
      } else {
        toast.error(err?.code ? pickMessage(err) : String(err?.message || err));
      }
    } finally {
      saveBtn.setLoading(false);
    }
  }

  function buildActions() {
    const bar = document.createElement('div');
    bar.className = 'profile-actions';
    bar.dataset.dirty = 'false';

    const statusNote = document.createElement('div');
    statusNote.className = 'profile-actions__status';
    statusNote.innerHTML = `
      <span class="profile-actions__dot" aria-hidden="true"></span>
      <span class="profile-actions__msg"></span>
    `;
    const msg = statusNote.querySelector('.profile-actions__msg');
    if (msg) msg.textContent = t('profile.all_saved', 'All changes saved');

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'profile-actions__buttons';

    saveBtn = Button({ label: t('profile.save', 'Save changes'), variant: 'primary', size: 'md', onClick: save });
    resetBtn = Button({
      label: t('common.cancel', 'Cancel'),
      variant: 'secondary',
      size: 'md',
      onClick: () => {
        pendingAvatar = undefined;
        render();
      },
    });
    resetBtn.setDisabled(true);

    buttonGroup.append(resetBtn, saveBtn);
    bar.append(statusNote, buttonGroup);
    return bar;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function render() {
    body.replaceChildren();

    body.append(buildHero());

    const grid = document.createElement('div');
    grid.className = 'profile-grid';

    const col1 = document.createElement('div');
    col1.className = 'profile-grid__col';
    col1.append(buildPersonalCard(), buildLocationCard());

    const col2 = document.createElement('div');
    col2.className = 'profile-grid__col';
    col2.append(buildContactCard(), buildPreferencesCard(), buildRelatedCard());

    grid.append(col1, col2);
    body.append(grid);

    actionsBar = buildActions();
    body.append(actionsBar);
  }

  async function load() {
    showSkeleton();
    try {
      const res = await api.get('/me/profile');
      saved = res?.data || res;
      pendingAvatar = undefined;
      render();
    } catch (err) {
      showError(err?.code ? pickMessage(err) : String(err?.message || err), load);
    }
  }

  root.append(container);
  load();
}
