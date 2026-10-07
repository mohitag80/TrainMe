'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Switch } from '@/components/controls';
import { Avatar, Card, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { units } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { Profile } from '@/lib/types';

type Text =
  | 'firstName'
  | 'middleName'
  | 'lastName'
  | 'mobile'
  | 'dateOfBirth'
  | 'gender'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'country';
const GENDERS: { value: NonNullable<Profile['gender']>; label: string }[] = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
  { value: 'NON_BINARY', label: 'Non-binary' },
  { value: 'UNDISCLOSED', label: 'Prefer not to say' },
];
/** Fields a complete profile needs, in the order they are reported. */
const REQUIRED: [keyof Form, string][] = [
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['mobile', 'Mobile number'],
  ['dateOfBirth', 'Date of birth'],
  ['gender', 'Gender'],
  ['height', 'Height'],
  ['weight', 'Weight'],
  ['addressLine1', 'Address'],
  ['city', 'City'],
  ['postalCode', 'Postal code'],
  ['country', 'Country'],
];
const AVATAR_PX = 256;

type Form = Record<Text | 'height' | 'weight', string>;

/** FR-PRF-01: who the person is. Units and time zone live on Settings; trainer status only for non-trainees. */
export default function ProfilePage() {
  const profile = useData<Profile>('/profiles/me');
  const [form, setForm] = useState<Partial<Form>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  const router = useRouter();
  const p = profile.data;
  const imperialLength = p?.unitPreferences.length === 'IMPERIAL';
  const imperialMass = p?.unitPreferences.mass === 'IMPERIAL';

  useEffect(() => {
    if (!p) return;
    const h = p.heightCm && (imperialLength ? round1(units.toDisplay(p.heightCm, 'cm', 'in')) : p.heightCm);
    const w = p.weightKg && (imperialMass ? round1(units.toDisplay(p.weightKg, 'kg', 'lb')) : p.weightKg);
    setForm({
      firstName: p.firstName ?? '',
      middleName: p.middleName ?? '',
      lastName: p.lastName ?? '',
      mobile: p.mobile ?? '',
      dateOfBirth: p.dateOfBirth ?? '',
      gender: p.gender ?? '',
      addressLine1: p.addressLine1 ?? '',
      addressLine2: p.addressLine2 ?? '',
      city: p.city ?? '',
      state: p.state ?? '',
      postalCode: p.postalCode ?? '',
      country: p.country ?? '',
      height: h ? String(h) : '',
      weight: w ? String(w) : '',
    });
  }, [p, imperialLength, imperialMass]);

  if (profile.error) return <ErrorBanner error={profile.error} />;
  if (!p) return <Spinner />;

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    if (missing.has(k)) setMissing(new Set([...missing].filter((x) => x !== k)));
  };
  const field = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span>
        {label}
        {REQUIRED.some(([r]) => r === k) ? '' : <span className="field-hint"> (optional)</span>}
      </span>
      <input value={form[k] ?? ''} onChange={set(k)} aria-invalid={missing.has(k) || undefined} {...props} />
      {missing.has(k) && <span className="field-error">Required</span>}
    </label>
  );

  async function save() {
    const gaps = REQUIRED.filter(([k]) => !(form[k] ?? '').trim());
    setMissing(new Set(gaps.map(([k]) => k)));
    if (gaps.length) {
      setMsg({ tone: 'bad', text: `Please fill in: ${gaps.map(([, l]) => l).join(', ')}.` });
      return;
    }
    const h = Number(form.height);
    const w = Number(form.weight);
    const heightCm = imperialLength ? round1(units.toCanonical(h, 'in', 'cm')) : h;
    const weightKg = imperialMass ? round1(units.toCanonical(w, 'lb', 'kg')) : w;
    if (!(heightCm >= 50 && heightCm <= 260))
      return setMsg({
        tone: 'bad',
        text: `Height must be between ${imperialLength ? '20 and 102 in' : '50 and 260 cm'}.`,
      });
    if (!(weightKg >= 20 && weightKg <= 400))
      return setMsg({
        tone: 'bad',
        text: `Weight must be between ${imperialMass ? '44 and 881 lb' : '20 and 400 kg'}.`,
      });
    try {
      const text = (k: Text) => (form[k] ?? '').trim();
      const updated = await api<Profile>('/profiles/me', {
        method: 'PUT',
        headers: { 'if-match': `"${p!.rowVersion}"` },
        body: {
          firstName: text('firstName'),
          middleName: text('middleName'),
          lastName: text('lastName'),
          mobile: text('mobile'),
          dateOfBirth: text('dateOfBirth'),
          gender: text('gender'),
          addressLine1: text('addressLine1'),
          addressLine2: text('addressLine2'),
          city: text('city'),
          state: text('state'),
          postalCode: text('postalCode'),
          country: text('country'),
          heightCm,
          weightKg,
        },
      });
      profile.setData({ ...p!, ...updated }); // keeps canCoach/coachingRole, which only GET returns
      setMsg({ tone: 'ok', text: 'Profile saved.' });
      router.refresh(); // the sidebar shows the name
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    }
  }

  const fullName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || p.displayName;
  return (
    <div className="stack">
      <PageHeader title="Profile" subtitle="Details that identify you. Units and time zone are under Settings." />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card title="Profile picture">
        <PictureEditor
          profile={p}
          name={fullName}
          onSaved={(updated, text) => {
            profile.setData({ ...p, ...updated });
            setMsg({ tone: 'ok', text });
            router.refresh();
          }}
          onError={(text) => setMsg({ tone: 'bad', text })}
        />
      </Card>

      <Card title="Name">
        <div className="form-grid">
          {field('firstName', 'First name', { autoComplete: 'given-name', maxLength: 60 })}
          {field('middleName', 'Middle name', { autoComplete: 'additional-name', maxLength: 60 })}
          {field('lastName', 'Last name', { autoComplete: 'family-name', maxLength: 60 })}
        </div>
      </Card>

      <Card title="Contact">
        <div className="form-grid">
          {field('mobile', 'Mobile number', {
            type: 'tel',
            inputMode: 'tel',
            autoComplete: 'tel',
            placeholder: 'e.g. +91 98765 43210',
            maxLength: 20,
          })}
          <label className="field">
            Email
            <input value={p.email ?? ''} readOnly disabled />
            <span className="field-hint">Your sign-in address – it cannot be changed here</span>
          </label>
        </div>
      </Card>

      <Card title="Address">
        <div className="form-grid">
          <div className="span-2">
            {field('addressLine1', 'Address', {
              autoComplete: 'address-line1',
              maxLength: 120,
              placeholder: 'House, street',
            })}
          </div>
          <div className="span-2">
            {field('addressLine2', 'Address line 2', {
              autoComplete: 'address-line2',
              maxLength: 120,
              placeholder: 'Area, landmark',
            })}
          </div>
          {field('city', 'City', { autoComplete: 'address-level2', maxLength: 80 })}
          {field('state', 'State / region', { autoComplete: 'address-level1', maxLength: 80 })}
          {field('postalCode', 'Postal code', { autoComplete: 'postal-code', maxLength: 16 })}
          {field('country', 'Country', { autoComplete: 'country-name', maxLength: 80 })}
        </div>
      </Card>

      <Card title="Personal">
        <div className="form-grid">
          {field('dateOfBirth', 'Date of birth', {
            type: 'date',
            autoComplete: 'bday',
            min: '1900-01-01',
            max: new Date().toISOString().slice(0, 10),
          })}
          <label className="field">
            Gender
            <select
              value={form.gender ?? ''}
              onChange={set('gender')}
              aria-invalid={missing.has('gender') || undefined}
            >
              <option value="" disabled>
                Choose…
              </option>
              {GENDERS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            {missing.has('gender') && <span className="field-error">Required</span>}
          </label>
          <label className="field">
            Height
            <div className="input-unit">
              <input type="number" inputMode="decimal" value={form.height ?? ''} onChange={set('height')} />
              <span className="unit">{imperialLength ? 'in' : 'cm'}</span>
            </div>
            {missing.has('height') && <span className="field-error">Required</span>}
          </label>
          <label className="field">
            Weight
            <div className="input-unit">
              <input type="number" inputMode="decimal" value={form.weight ?? ''} onChange={set('weight')} />
              <span className="unit">{imperialMass ? 'lb' : 'kg'}</span>
            </div>
            {missing.has('weight') && <span className="field-error">Required</span>}
          </label>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          Height and weight show in the units chosen under <Link href="/settings">Settings</Link>.
        </p>
      </Card>

      {/* Coach or trainee, never both: trainees (and technical accounts) never see this. */}
      {(p.coachingRole === 'TRAINER' || p.coachingRole === 'NONE') && (
        <TrainerCard
          profile={p}
          onSaved={async (text) => {
            setMsg({ tone: 'ok', text });
            await profile.reload();
            // The sidebar swaps My trainers for Coaching: re-render the server layout.
            router.refresh();
          }}
        />
      )}

      <div className="row gap">
        <button className="btn btn-primary btn-lg" onClick={() => void save()}>
          Save profile
        </button>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await api('/profiles/me/export', { method: 'POST' });
            setMsg({ tone: 'ok', text: 'Export requested – you will get a download link within 24 hours.' });
          }}
        >
          Download my data
        </button>
      </div>
    </div>
  );
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Optional picture: cropped to a centred square and shrunk to 256 px in the browser, then uploaded as JPEG. */
function PictureEditor({
  profile,
  name,
  onSaved,
  onError,
}: {
  profile: Profile;
  name: string;
  onSaved: (p: Profile, msg: string) => void;
  onError: (msg: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) return onError('Choose an image file (JPEG, PNG or WebP).');
    setBusy(true);
    try {
      const image = await shrink(file);
      onSaved(await api<Profile>('/profiles/me/avatar', { method: 'PUT', body: { image } }), 'Profile picture saved.');
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="row gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Avatar name={name} version={profile.avatarUpdatedAt} size={88} />
      <div className="stack" style={{ gap: 8 }}>
        <div className="row gap">
          <button className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : profile.avatarUpdatedAt ? 'Change picture' : 'Upload picture'}
          </button>
          {profile.avatarUpdatedAt && (
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={async () => {
                try {
                  onSaved(await api<Profile>('/profiles/me/avatar', { method: 'DELETE' }), 'Profile picture removed.');
                } catch (e) {
                  onError(errorText(e));
                }
              }}
            >
              Remove
            </button>
          )}
        </div>
        <span className="small muted">Optional. A square crop of the middle of your photo is used.</span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
    </div>
  );
}

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This picture could not be read. Try a JPEG or PNG.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_PX;
  canvas
    .getContext('2d')!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * FR-COA-01: self-service trainer status. Shown only to people who are not trainees – a coach never has a coach,
 * and a trainee never coaches (the server enforces both).
 */
function TrainerCard({ profile, onSaved }: { profile: Profile; onSaved: (msg: string) => Promise<void> }) {
  const [isTrainer, setIsTrainer] = useState(!!profile.isTrainer);
  const [bio, setBio] = useState(profile.trainerBio ?? '');
  const [specialties, setSpecialties] = useState((profile.trainerSpecialties ?? []).join(', '));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <Card title={profile.isTrainer ? 'Trainer details' : 'Are you a coach?'}>
      <Switch
        checked={isTrainer}
        onChange={setIsTrainer}
        label="I coach or train others"
        hint="Trainees can then find you, connect, and pick you for their sessions. A coach cannot have a trainer of their own."
      />
      {isTrainer && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="field span-2">
            About you as a trainer
            <textarea
              rows={2}
              maxLength={500}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="e.g. Level 2 cricket coach, 10 years with fast bowlers"
            />
          </label>
          <label className="field span-2">
            Specialties
            <input
              value={specialties}
              onChange={(e) => setSpecialties(e.target.value)}
              placeholder="e.g. Fast bowling, Strength & conditioning"
            />
            <span className="field-hint">Separate with commas – trainees can search for these</span>
          </label>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
      <button
        className="btn btn-sm"
        style={{ marginTop: 12 }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api('/profiles/me/trainer', {
              method: 'PUT',
              body: {
                isTrainer,
                bio: bio.trim() || null,
                specialties: specialties
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
            });
            setError(undefined);
            await onSaved(
              isTrainer
                ? 'You are listed as a trainer. Open Coaching in the menu to invite trainees.'
                : 'You are no longer listed as a trainer.',
            );
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save trainer details
      </button>
    </Card>
  );
}
