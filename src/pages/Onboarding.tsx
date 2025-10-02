import React, { useState } from 'react';
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Button,
  Typography,
  Paper,
  TextField,
  RadioGroup,
  FormControlLabel,
  Radio,
  CircularProgress,
  Alert,
  Grid,
  Card,
  CardContent,
  Chip,
  LinearProgress,
} from '@mui/material';
import {
  Computer as ComputerIcon,
  Folder as FolderIcon,
  CheckCircle as CheckIcon,
} from '@mui/icons-material';
import { useApp } from '../contexts/AppContext';
import { useSettings } from '../contexts/SettingsContext';

const languages = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
];

const techStacks = [
  { id: 'general', name: 'General Projects', icon: '🛡️' },
  { id: 'node', name: 'Node.js / JavaScript', icon: '📦' },
  { id: 'python', name: 'Python', icon: '🐍' },
  { id: 'django', name: 'Django', icon: '🎸' },
  { id: 'flutter', name: 'Flutter / Dart', icon: '🦋' },
  { id: 'ios', name: 'iOS / Xcode', icon: '🍎' },
  { id: 'android', name: 'Android', icon: '🤖' },
  { id: 'unity', name: 'Unity', icon: '🎮' },
  { id: 'unreal', name: 'Unreal Engine', icon: '🎯' },
];

export default function Onboarding() {
  const { setOnboardingComplete } = useApp();
  const { updateLanguage, updateConfig } = useSettings();

  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step states
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [deviceRole, setDeviceRole] = useState<'home' | 'school'>('home');
  const [mainFolderPath, setMainFolderPath] = useState('');
  const [selectedPresets, setSelectedPresets] = useState<string[]>(['general']);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingQR, setPairingQR] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);

  const handleNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleLanguageSelect = async () => {
    try {
      await updateLanguage(selectedLanguage);
      handleNext();
    } catch (error) {
      setError('Failed to update language');
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const path = await window.electronAPI.browseFolder();
      if (path) {
        setMainFolderPath(path);
      }
    } catch (error) {
      setError('Failed to browse folder');
    }
  };

  const handleCreateMainFolder = async () => {
    if (!mainFolderPath) {
      setError('Please select a folder');
      return;
    }

    try {
      setLoading(true);
      const folder = await window.electronAPI.addFolder({
        path: mainFolderPath,
        name: 'Main Projects',
        mode: 'send-receive',
        devices: [],
        ignorePatterns: [],
      });

      // Apply selected presets
      if (selectedPresets.length > 0 && folder?.id) {
        const uniquePresets = Array.from(new Set(selectedPresets));
        await window.electronAPI.applyIgnorePresets(folder.id, uniquePresets);
      }

      setLoading(false);
      handleNext();
    } catch (error) {
      setLoading(false);
      setError('Failed to create folder');
    }
  };

  const handleGeneratePairingCode = async () => {
    try {
      setIsGeneratingCode(true);
      const result = await window.electronAPI.generatePairingCode();
      setPairingCode(result.code);
      setPairingQR(result.qrCode);
      setIsGeneratingCode(false);
    } catch (error) {
      setIsGeneratingCode(false);
      setError('Failed to generate pairing code');
    }
  };

  const handlePairDevice = async () => {
    if (!pairingCode || pairingCode.length !== 6) {
      setError('Please enter a valid 6-character code');
      return;
    }

    try {
      setIsPairing(true);
      await window.electronAPI.pairDevice(pairingCode);
      setIsPairing(false);
      handleNext();
    } catch (error) {
      setIsPairing(false);
      setError('Failed to pair device. Please check the code and try again.');
    }
  };

  const handleComplete = async () => {
    try {
      setLoading(true);

      // Save onboarding state
      await updateConfig({
        onboardingState: {
          completed: true,
          currentStep: activeStep,
          deviceRole,
          selectedPresets,
          skipTutorial: false,
        },
      } as any);

      setOnboardingComplete(true);
    } catch (error) {
      setLoading(false);
      setError('Failed to complete setup');
    }
  };

  const steps = [
    {
      label: 'Welcome',
      content: (
        <Box>
          <Typography variant="h5" gutterBottom>
            Welcome to AirSync-Lite
          </Typography>
          <Typography variant="body1" paragraph>
            Let&apos;s set up automatic file synchronization between your Home and School computers.
            This will take just two minutes.
          </Typography>

          <Box mt={3}>
            <Typography variant="subtitle2" gutterBottom>
              Select your language:
            </Typography>
            <RadioGroup
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
            >
              {languages.map((lang) => (
                <FormControlLabel
                  key={lang.code}
                  value={lang.code}
                  control={<Radio />}
                  label={`${lang.native} (${lang.name})`}
                />
              ))}
            </RadioGroup>
          </Box>

          <Box mt={3}>
            <Button variant="contained" onClick={handleLanguageSelect}>
              Continue
            </Button>
          </Box>
        </Box>
      ),
    },
    {
      label: 'Device Role',
      content: (
        <Box>
          <Typography variant="h5" gutterBottom>
            What is this device?
          </Typography>
          <Typography variant="body1" paragraph>
            Choose the role of this computer. This helps us optimize settings for your use case.
          </Typography>

          <Grid container spacing={2} sx={{ mt: 2 }}>
            <Grid item xs={12} sm={6}>
              <Card
                sx={{
                  cursor: 'pointer',
                  border: deviceRole === 'home' ? '2px solid #2196f3' : '1px solid #e0e0e0',
                  transition: 'all 0.3s',
                }}
                onClick={() => setDeviceRole('home')}
              >
                <CardContent sx={{ textAlign: 'center' }}>
                  <ComputerIcon sx={{ fontSize: 48, mb: 2 }} />
                  <Typography variant="h6">Home Computer</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Your main computer where you work on projects
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Card
                sx={{
                  cursor: 'pointer',
                  border: deviceRole === 'school' ? '2px solid #2196f3' : '1px solid #e0e0e0',
                  transition: 'all 0.3s',
                }}
                onClick={() => setDeviceRole('school')}
              >
                <CardContent sx={{ textAlign: 'center' }}>
                  <ComputerIcon sx={{ fontSize: 48, mb: 2 }} />
                  <Typography variant="h6">School Computer</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Computer at school/work (receive-only recommended)
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {deviceRole === 'school' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              School computers will be set to &quot;Receive Only&quot; mode by default to prevent
              accidental changes.
            </Alert>
          )}

          <Box mt={3} display="flex" gap={2}>
            <Button onClick={handleBack}>Back</Button>
            <Button variant="contained" onClick={handleNext}>
              Continue
            </Button>
          </Box>
        </Box>
      ),
    },
    {
      label: 'Main Folder',
      content: (
        <Box>
          <Typography variant="h5" gutterBottom>
            Choose your main projects folder
          </Typography>
          <Typography variant="body1" paragraph>
            Select the folder where you keep your projects. We&apos;ll sync everything inside it.
          </Typography>

          <Paper
            sx={{
              p: 3,
              mt: 3,
              border: '2px dashed #e0e0e0',
              cursor: 'pointer',
              textAlign: 'center',
              '&:hover': {
                borderColor: '#2196f3',
                bgcolor: 'rgba(33, 150, 243, 0.05)',
              },
            }}
            onClick={handleBrowseFolder}
          >
            <FolderIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body1">{mainFolderPath || 'Click to select folder'}</Typography>
            {!mainFolderPath && (
              <Typography variant="caption" color="text.secondary">
                Recommended: ~/Documents/Projects or D:\Projects
              </Typography>
            )}
          </Paper>

          <Box mt={3}>
            <Typography variant="subtitle2" gutterBottom>
              What type of projects do you work on?
            </Typography>
            <Typography variant="caption" color="text.secondary" paragraph>
              We&apos;ll automatically ignore build files and dependencies for selected tech stacks
            </Typography>

            <Grid container spacing={1}>
              {techStacks.map((stack) => (
                <Grid item key={stack.id}>
                  <Chip
                    label={`${stack.icon} ${stack.name}`}
                    onClick={() => {
                      if (selectedPresets.includes(stack.id)) {
                        setSelectedPresets((prev) => prev.filter((id) => id !== stack.id));
                      } else {
                        setSelectedPresets((prev) => [...prev, stack.id]);
                      }
                    }}
                    color={selectedPresets.includes(stack.id) ? 'primary' : 'default'}
                    variant={selectedPresets.includes(stack.id) ? 'filled' : 'outlined'}
                  />
                </Grid>
              ))}
            </Grid>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Box mt={3} display="flex" gap={2}>
            <Button onClick={handleBack}>Back</Button>
            <Button
              variant="contained"
              onClick={handleCreateMainFolder}
              disabled={!mainFolderPath || loading}
            >
              {loading ? <CircularProgress size={24} /> : 'Continue'}
            </Button>
          </Box>
        </Box>
      ),
    },
    {
      label: 'Connect Devices',
      content: (
        <Box>
          <Typography variant="h5" gutterBottom>
            Connect your second device
          </Typography>
          <Typography variant="body1" paragraph>
            Now let&apos;s connect your {deviceRole === 'home' ? 'school' : 'home'} computer.
          </Typography>

          <Grid container spacing={3} sx={{ mt: 2 }}>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Option 1: QR Code
                </Typography>
                <Typography variant="body2" paragraph>
                  Scan this QR code from your other device
                </Typography>

                {pairingQR ? (
                  <Box textAlign="center">
                    <img src={pairingQR} alt="Pairing QR Code" style={{ maxWidth: '100%' }} />
                    <Typography variant="h6" sx={{ mt: 2 }}>
                      Code: {pairingCode}
                    </Typography>
                  </Box>
                ) : (
                  <Box textAlign="center">
                    <Button
                      variant="contained"
                      onClick={handleGeneratePairingCode}
                      disabled={isGeneratingCode}
                    >
                      {isGeneratingCode ? <CircularProgress size={24} /> : 'Generate QR Code'}
                    </Button>
                  </Box>
                )}
              </Paper>
            </Grid>

            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Option 2: Manual Code
                </Typography>
                <Typography variant="body2" paragraph>
                  Enter the 6-character code from your other device
                </Typography>

                <TextField
                  fullWidth
                  label="Pairing Code"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                  inputProps={{
                    maxLength: 6,
                    style: { textTransform: 'uppercase', letterSpacing: '0.2em' },
                  }}
                  placeholder="ABC123"
                  sx={{ mt: 2 }}
                />

                <Button
                  fullWidth
                  variant="contained"
                  onClick={handlePairDevice}
                  disabled={!pairingCode || pairingCode.length !== 6 || isPairing}
                  sx={{ mt: 2 }}
                >
                  {isPairing ? <CircularProgress size={24} /> : 'Connect Device'}
                </Button>
              </Paper>
            </Grid>
          </Grid>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Box mt={3} display="flex" gap={2}>
            <Button onClick={handleBack}>Back</Button>
            <Button variant="outlined" onClick={handleNext}>
              Skip for Now
            </Button>
          </Box>
        </Box>
      ),
    },
    {
      label: 'Complete',
      content: (
        <Box textAlign="center">
          <CheckIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Setup Complete!
          </Typography>
          <Typography variant="body1" paragraph>
            AirSync-Lite is ready to keep your files in sync.
          </Typography>

          <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              What happens next:
            </Typography>
            <Typography variant="body2" align="left" component="div">
              • Files in your main folder will sync automatically
              <br />
              • Connect more devices anytime from the Devices page
              <br />
              • Add more folders from the Folders page
              <br />• Check sync status in the system tray
            </Typography>
          </Box>

          <Button
            variant="contained"
            size="large"
            onClick={handleComplete}
            disabled={loading}
            sx={{ mt: 3 }}
          >
            {loading ? <CircularProgress size={24} /> : 'Start Using AirSync-Lite'}
          </Button>
        </Box>
      ),
    },
  ];

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', py: 4 }}>
      <Stepper activeStep={activeStep} orientation="vertical">
        {steps.map((step, index) => (
          <Step key={step.label}>
            <StepLabel
              optional={
                index === steps.length - 1 ? (
                  <Typography variant="caption">Last step</Typography>
                ) : null
              }
            >
              {step.label}
            </StepLabel>
            <StepContent>{step.content}</StepContent>
          </Step>
        ))}
      </Stepper>

      {activeStep > 0 && activeStep < steps.length && (
        <LinearProgress
          variant="determinate"
          value={(activeStep / (steps.length - 1)) * 100}
          sx={{ mt: 4 }}
        />
      )}
    </Box>
  );
}
