import React, { useState } from 'react'
import { saveSettings } from '../supabase'

export default function SettingsScreen({ user, profile, onBack, onProfileUpdated }) {
  const [weightUnit,    setWeightUnit]    = useState(profile?.weight_unit    || 'kg')
  const [intensityMode, setIntensityMode] = useState(profile?.intensity_mode || 'off')
  const [uiMode,        setUiMode]        = useState(profile?.ui_mode        || 'classic')
  const [error, setError] = useState('')

  const updateField = async (field, value, setter, prev) => {
    setter(value)
    setError('')
    try {
      await saveSettings({ [field]: value }, user.id)
      onProfileUpdated?.({ ...profile, [field]: value })
    } catch (e) {
      setter(prev)
      setError(e.message || 'Save failed')
    }
  }

  return (
    <div className="screen">
      <header className="sub-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">Settings</div>
        </div>
      </header>

      <div className="content">

        {/* UI mode — Classic vs Simplified */}
        <div className="setting-block">
          <div className="setting-label">Interface</div>
          <div className="setting-sub">
            <strong>Classic</strong> shows every control on the workout screen (warmup chip, remove-set, modal prompts). <strong>Simplified</strong> hides the chrome you don't need: cards collapse when finished, one rest pill, lighter prompts. You can switch back any time.
          </div>
          <div className="segmented-control">
            <button
              className={`segmented-option ${uiMode === 'classic' ? 'segmented-option--active' : ''}`}
              onClick={() => updateField('ui_mode', 'classic', setUiMode, uiMode)}
            >Classic</button>
            <button
              className={`segmented-option ${uiMode === 'simplified' ? 'segmented-option--active' : ''}`}
              onClick={() => updateField('ui_mode', 'simplified', setUiMode, uiMode)}
            >Simplified</button>
          </div>
        </div>

        {/* Units */}
        <div className="setting-block">
          <div className="setting-label">Units</div>
          <div className="setting-sub">Affects weight entry and display across the app</div>
          <div className="segmented-control">
            <button
              className={`segmented-option ${weightUnit === 'kg' ? 'segmented-option--active' : ''}`}
              onClick={() => updateField('weight_unit', 'kg', setWeightUnit, weightUnit)}
            >kg</button>
            <button
              className={`segmented-option ${weightUnit === 'lbs' ? 'segmented-option--active' : ''}`}
              onClick={() => updateField('weight_unit', 'lbs', setWeightUnit, weightUnit)}
            >lbs</button>
          </div>
        </div>

        {/* Intensity mode */}
        <div className="setting-block">
          <div className="setting-label">Intensity tracking</div>
          <div className="setting-sub">
            Optional per-set effort input. Off keeps the UI clean; RIR tracks reps-in-reserve; RPE tracks perceived exertion.
          </div>
          <div className="segmented-control segmented-control--3">
            <button
              className={`segmented-option ${intensityMode === 'off' ? 'segmented-option--active' : ''}`}
              onClick={() => updateField('intensity_mode', 'off', setIntensityMode, intensityMode)}
            >Off</button>
            <button
              className={`segmented-option ${intensityMode === 'rir' ? 'segmented-option--active' : ''}`}
              onClick={() => updateField('intensity_mode', 'rir', setIntensityMode, intensityMode)}
            >RIR</button>
            <button
              className={`segmented-option ${intensityMode === 'rpe' ? 'segmented-option--active' : ''}`}
              onClick={() => updateField('intensity_mode', 'rpe', setIntensityMode, intensityMode)}
            >RPE</button>
          </div>
        </div>

        {error && <div className="err-msg" style={{ marginTop: 8 }}>{error}</div>}

        <div style={{ height: 48 }} />
      </div>
    </div>
  )
}
