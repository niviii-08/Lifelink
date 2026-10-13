import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouting, type Page } from '../context/RoutingContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api';

export const Auth: React.FC = () => {
  const { signup, login, googleSignIn } = useAuth();
  const { navigateTo } = useRouting();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'register' | 'signin'>('register');
  const [selectedRole, setSelectedRole] = useState<'Donor' | 'Patient' | 'Hospital' | 'Blood Bank'>('Donor');
  const [donorCount, setDonorCount] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getAnalyticsSummary().then((s) => setDonorCount(s.totalDonors)).catch(() => setDonorCount(null));
  }, []);

  // Register Fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [city, setCity] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [registerPassword, setRegisterPassword] = useState('');

  // Login Fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const handleRoleCardClick = (role: 'Donor' | 'Patient' | 'Hospital' | 'Blood Bank') => {
    setSelectedRole(role);
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !email || !registerPassword) {
      showToast('warning', '⚠️ Missing Info', 'Please fill in all required fields.');
      return;
    }

    const finalRole = selectedRole === 'Patient' ? 'Donor' : selectedRole;
    const fullName = finalRole === 'Donor' ? `${firstName} ${lastName}`.trim() : firstName.trim();
    const finalBloodType = finalRole === 'Donor' ? (bloodGroup || 'O+') : 'Multiple';
    const finalCity = city.trim() || 'Coimbatore';

    const pendingUser = {
      name: fullName,
      email: email.trim(),
      role: finalRole,
      bloodType: finalBloodType,
      location: finalCity,
      status: 'Pending Verification',
      isNewRegistration: true,
      password: registerPassword,
      licenseNumber: licenseNumber,
      accreditationDoc: uploadedFile ? uploadedFile.name : '',
    };

    setLoading(true);
    try {
      await signup(pendingUser);
      navigateTo('home');
    } catch (err: any) {
      // Toast shown in context
    } finally {
      setLoading(false);
    }
  };

  const handleSigninSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      showToast('warning', '⚠️ Missing Credentials', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const loggedUser = await login(loginEmail, loginPassword);
      const targetPage: Page =
        loggedUser.role === 'Donor'
          ? 'donor-dash'
          : loggedUser.role === 'Hospital'
          ? 'hospital'
          : loggedUser.role === 'Blood Bank'
          ? 'bloodbank'
          : 'dashboard';
      navigateTo(targetPage);
    } catch (err) {
      // Toast handled in context
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const loggedUser = await googleSignIn(activeTab === 'register' ? selectedRole : undefined);
      const targetPage: Page =
        loggedUser.role === 'Donor'
          ? 'donor-dash'
          : loggedUser.role === 'Hospital'
          ? 'hospital'
          : loggedUser.role === 'Blood Bank'
          ? 'bloodbank'
          : 'dashboard';
      navigateTo(targetPage);
    } catch (err) {
      // Toast handled in context
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0]);
    }
  };

  return (
    <div className="page active" id="auth">
      <div className="auth-wrap">
        {/* Left pane - brand */}
        <div className="auth-left">
          <div style={{ fontSize: '2rem', fontWeight: 900, color: '#f87171', marginBottom: '1rem' }}>
            🩸 LifeLink
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, textAlign: 'center', marginBottom: '.75rem', maxWidth: '300px' }}>
            {donorCount !== null ? `Join ${donorCount}+ heroes saving lives every day` : 'Join a growing community of lifesaving heroes'}
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center', maxWidth: '280px', lineHeight: 1.7, marginBottom: '2rem' }}>
            Create your account to respond to emergencies, book appointments, and earn rewards for every donation.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '280px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#94a3b8', fontSize: '13px' }}>
              <span style={{ width: '26px', height: '26px', background: 'rgba(231,76,60,.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800, color: '#f87171', flexShrink: 0 }}>1</span>
              Create your profile in 2 minutes
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#94a3b8', fontSize: '13px' }}>
              <span style={{ width: '26px', height: '26px', background: 'rgba(231,76,60,.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800, color: '#f87171', flexShrink: 0 }}>2</span>
              Get AI-matched to emergencies near you
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#94a3b8', fontSize: '13px' }}>
              <span style={{ width: '26px', height: '26px', background: 'rgba(231,76,60,.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800, color: '#f87171', flexShrink: 0 }}>3</span>
              Track live inventory & map routes instantly
            </div>
          </div>
        </div>

        {/* Right pane - forms */}
        <div className="auth-right">
          <div className="auth-box">
            
            {/* Tabs Selector */}
            <div style={{ display: 'flex', gap: '20px', borderBottom: '1px solid var(--gr4)', marginBottom: '1.5rem' }}>
              <div 
                className={`auth-tab ${activeTab === 'register' ? 'active' : ''}`}
                style={{
                  paddingBottom: '10px',
                  fontWeight: 700,
                  fontSize: '15px',
                  cursor: 'pointer',
                  borderBottom: activeTab === 'register' ? '3px solid var(--red)' : 'none',
                  color: activeTab === 'register' ? 'var(--tx)' : 'var(--gr)'
                }}
                onClick={() => setActiveTab('register')}
              >
                Register
              </div>
              <div 
                className={`auth-tab ${activeTab === 'signin' ? 'active' : ''}`}
                style={{
                  paddingBottom: '10px',
                  fontWeight: 700,
                  fontSize: '15px',
                  cursor: 'pointer',
                  borderBottom: activeTab === 'signin' ? '3px solid var(--red)' : 'none',
                  color: activeTab === 'signin' ? 'var(--tx)' : 'var(--gr)'
                }}
                onClick={() => setActiveTab('signin')}
              >
                Sign In
              </div>
            </div>

            {activeTab === 'register' ? (
              <form onSubmit={handleSignupSubmit} id="auth-register-form">
                <div className="auth-title">Create your account</div>
                <div className="auth-sub">Choose your role to get started</div>
                
                {/* Role Toggles */}
                <div className="role-grid">
                  <div className={`role-card ${selectedRole === 'Donor' ? 'sel' : ''}`} onClick={() => handleRoleCardClick('Donor')}>
                    <div className="role-icon">💉</div>
                    <div className="role-name">Donor</div>
                  </div>
                  <div className={`role-card ${selectedRole === 'Patient' ? 'sel' : ''}`} onClick={() => handleRoleCardClick('Patient')}>
                    <div className="role-icon">🧑‍⚕️</div>
                    <div className="role-name">Patient / Family</div>
                  </div>
                  <div className={`role-card ${selectedRole === 'Hospital' ? 'sel' : ''}`} onClick={() => handleRoleCardClick('Hospital')}>
                    <div className="role-icon">🏥</div>
                    <div className="role-name">Hospital</div>
                  </div>
                  <div className={`role-card ${selectedRole === 'Blood Bank' ? 'sel' : ''}`} onClick={() => handleRoleCardClick('Blood Bank')}>
                    <div className="role-icon">🩸</div>
                    <div className="role-name">Blood Bank</div>
                  </div>
                </div>

                {/* Name fields */}
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">
                      {selectedRole === 'Donor' || selectedRole === 'Patient' ? 'First Name' : 'Facility Name'}
                    </label>
                    <input 
                      className="form-input" 
                      placeholder={selectedRole === 'Donor' || selectedRole === 'Patient' ? 'Arjun' : 'Apollo Hospital'} 
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  
                  {(selectedRole === 'Donor' || selectedRole === 'Patient') && (
                    <div className="form-group">
                      <label className="form-label">Last Name</label>
                      <input 
                        className="form-input" 
                        placeholder="Kumar" 
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input 
                    className="form-input" 
                    type="email" 
                    placeholder="arjun@email.com" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {/* Blood and location inputs */}
                <div className="form-grid-2">
                  {(selectedRole === 'Donor' || selectedRole === 'Patient') && (
                    <div className="form-group">
                      <label className="form-label">Blood Group</label>
                      <select 
                        className="form-input"
                        value={bloodGroup}
                        onChange={(e) => setBloodGroup(e.target.value)}
                      >
                        <option value="">Select</option>
                        <option>A+</option><option>A-</option>
                        <option>B+</option><option>B-</option>
                        <option>O+</option><option>O-</option>
                        <option>AB+</option><option>AB-</option>
                      </select>
                    </div>
                  )}
                  
                  <div className="form-group">
                    <label className="form-label">City</label>
                    <input 
                      className="form-input" 
                      placeholder="Coimbatore" 
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </div>
                </div>

                {/* License Inputs for Institutions */}
                {(selectedRole === 'Hospital' || selectedRole === 'Blood Bank') && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Medical License Number / Reg ID</label>
                      <input 
                        className="form-input" 
                        placeholder="e.g. HOSP-2026-CBE-9842" 
                        value={licenseNumber}
                        onChange={(e) => setLicenseNumber(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Accreditation Certificate (PDF/Image)</label>
                      <div 
                        style={{ position: 'relative', border: '2px dashed var(--gr3)', padding: '1rem', borderRadius: 'var(--r)', textAlign: 'center', background: 'var(--gr4)', cursor: 'pointer' }}
                        onClick={() => document.getElementById('signup-file-input')?.click()}
                      >
                        <span style={{ fontSize: '1.5rem' }}>📤</span>
                        <div style={{ fontSize: '12px', color: 'var(--gr)', fontWeight: 600, marginTop: '6px' }}>
                          {uploadedFile ? `📄 ${uploadedFile.name}` : 'Click to upload license certificate (PDF/JPG)'}
                        </div>
                        <input 
                          type="file" 
                          id="signup-file-input" 
                          style={{ display: 'none' }} 
                          onChange={handleFileChange}
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input 
                    className="form-input" 
                    type="password" 
                    placeholder="Min. 6 characters" 
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-red btn-full btn-lg" style={{ marginTop: '.5rem' }} disabled={loading}>
                  {loading ? 'Creating...' : 'Create Account'}
                </button>
                
                <div className="divider">or continue with</div>
                <button 
                  type="button" 
                  className="btn btn-gray btn-full" 
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                >
                  🔵 Continue with Google
                </button>
                <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '13px', color: 'var(--gr)' }}>
                  Already have an account?{' '}
                  <a onClick={() => setActiveTab('signin')} style={{ color: 'var(--red)', fontWeight: 600, cursor: 'pointer' }}>
                    Sign In
                  </a>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSigninSubmit} id="auth-signin-form">
                <div className="auth-title">Welcome back</div>
                <div className="auth-sub">Enter your account credentials to access your dashboard</div>
                
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input 
                    className="form-input" 
                    type="email"
                    placeholder="arjun@email.com" 
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input 
                    className="form-input" 
                    type="password" 
                    placeholder="••••••••" 
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
                
                <button type="submit" className="btn btn-red btn-full btn-lg" style={{ marginTop: '1rem' }} disabled={loading}>
                  {loading ? 'Signing In...' : 'Sign In'}
                </button>
                
                <div className="divider">or continue with</div>
                <button 
                  type="button" 
                  className="btn btn-gray btn-full" 
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                >
                  🔵 Continue with Google
                </button>
                <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '13px', color: 'var(--gr)' }}>
                  Don't have an account?{' '}
                  <a onClick={() => setActiveTab('register')} style={{ color: 'var(--red)', fontWeight: 600, cursor: 'pointer' }}>
                    Register
                  </a>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
export default Auth;
