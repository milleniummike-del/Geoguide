<?php
/**
 * RENAME THIS FILE TO server.php
 * 
 * GeoGuide AI - PHP Backend Implementation
 * 
 * MODULAR ARCHITECTURE:
 * Decouples Data Persistence (Tours) from Media Storage (Images/Audio).
 * Matches the logic of the Node.js backend/server.js.
 * 
 * REQUIREMENTS:
 * - PHP 7.4+
 * - Write permissions on 'tours.json' and 'uploads/' directory.
 * 
 * CONFIGURATION:
 * Set environment variables in your server configuration or modify the defaults below.
 */

// Headers for CORS
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// --- Configuration ---
// Options: FILE (Default), MEMORY (Not persistent in PHP), FIRESTORE (Requires SDK)
$persistenceMode = getenv('PERSISTENCE_MODE') ?: 'FILE'; 
// Options: DISK (Default), GCS (Requires SDK)
$storageMode = getenv('STORAGE_MODE') ?: 'DISK';       
// Base URL for constructing file links
$baseUrl = getenv('BASE_URL') ?: (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://$_SERVER[HTTP_HOST]";

// Handle subdirectory logic for uploads URL construction
$scriptDir = dirname($_SERVER['SCRIPT_NAME']);
$scriptDir = $scriptDir === '/' ? '' : $scriptDir;
$fullBaseUrl = rtrim($baseUrl . $scriptDir, '/');

// --- Interfaces & Strategies ---

interface PersistenceStrategy {
    public function getTours();
    public function getTour($id);
    public function saveTour($tour);
    public function deleteTour($id);
}

interface StorageStrategy {
    public function uploadFile($file);
}

/**
 * 1. Persistence: File (JSON)
 * Stores data in a local tours.json file.
 */
class FilePersistence implements PersistenceStrategy {
    private $dataFile;

    public function __construct() {
        $this->dataFile = __DIR__ . '/tours.json';
    }

    private function load() {
        if (!file_exists($this->dataFile)) return [];
        $content = file_get_contents($this->dataFile);
        return json_decode($content, true) ?: [];
    }

    private function save($tours) {
        file_put_contents($this->dataFile, json_encode($tours, JSON_PRETTY_PRINT));
    }

    public function getTours() {
        return $this->load();
    }

    public function getTour($id) {
        $tours = $this->load();
        foreach ($tours as $t) {
            if ($t['id'] === $id) return $t;
        }
        return null;
    }

    public function saveTour($tour) {
        $tours = $this->load();
        $index = -1;
        foreach ($tours as $k => $t) {
            if ($t['id'] === $tour['id']) {
                $index = $k;
                break;
            }
        }

        if ($index >= 0) {
            $tours[$index] = $tour;
        } else {
            $tours[] = $tour;
        }
        $this->save($tours);
        return $tour;
    }

    public function deleteTour($id) {
        $tours = $this->load();
        $newTours = [];
        foreach ($tours as $t) {
            if ($t['id'] !== $id) {
                $newTours[] = $t;
            }
        }
        $this->save($newTours);
    }
}

/**
 * 2. Storage: Disk (Local)
 * Saves files to the 'uploads' directory.
 */
class DiskStorage implements StorageStrategy {
    private $uploadsDir;
    private $uploadsUrl;

    public function __construct($baseUrl) {
        $this->uploadsDir = __DIR__ . '/uploads';
        $this->uploadsUrl = $baseUrl . '/uploads';
        
        if (!file_exists($this->uploadsDir)) {
            mkdir($this->uploadsDir, 0777, true);
        }
    }

    public function uploadFile($file) {
        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        $filename = time() . '-' . rand(1000, 9999) . '.' . $ext;
        $destination = $this->uploadsDir . '/' . $filename;

        if (move_uploaded_file($file['tmp_name'], $destination)) {
            return $this->uploadsUrl . '/' . $filename;
        }
        throw new Exception("Failed to move uploaded file");
    }
}

// --- Placeholders for Cloud Features ---
// To use Firestore or GCS in PHP, you would generally use the 'google/cloud-firestore' and 
// 'google/cloud-storage' Composer packages. This script assumes a simple environment without Composer.

class FirestorePersistenceStub implements PersistenceStrategy {
    public function getTours() { throw new Exception("Firestore requires Google Cloud PHP Client Library"); }
    public function getTour($id) { throw new Exception("Firestore requires Google Cloud PHP Client Library"); }
    public function saveTour($tour) { throw new Exception("Firestore requires Google Cloud PHP Client Library"); }
    public function deleteTour($id) { throw new Exception("Firestore requires Google Cloud PHP Client Library"); }
}

// --- Initialization ---

$persistence = null;
switch ($persistenceMode) {
    case 'FIRESTORE': $persistence = new FirestorePersistenceStub(); break;
    case 'FILE': default: $persistence = new FilePersistence(); break;
}

$storage = null;
switch ($storageMode) {
    case 'GCS': throw new Exception("GCS requires Google Cloud PHP Client Library");
    case 'DISK': default: $storage = new DiskStorage($fullBaseUrl); break;
}

// --- Routing & Request Handling ---

$requestUri = $_SERVER['REQUEST_URI'];
$method = $_SERVER['REQUEST_METHOD'];

try {
    // Route: /api/upload
    if (strpos($requestUri, '/api/upload') !== false && $method === 'POST') {
        if (isset($_FILES['file'])) {
            $url = $storage->uploadFile($_FILES['file']);
            echo json_encode(['url' => $url]);
        } else {
            http_response_code(400);
            echo json_encode(['message' => 'No file uploaded']);
        }
        exit;
    }

    // Route: /api/tours
    if (strpos($requestUri, '/api/tours') !== false) {
        // Parse ID from URL
        $path = parse_url($requestUri, PHP_URL_PATH);
        $parts = explode('/', trim($path, '/'));
        $toursIndex = array_search('tours', $parts);
        $id = ($toursIndex !== false && isset($parts[$toursIndex + 1])) ? $parts[$toursIndex + 1] : null;

        if ($method === 'GET') {
            if ($id) {
                $tour = $persistence->getTour($id);
                if ($tour) echo json_encode($tour);
                else {
                    http_response_code(404);
                    echo json_encode(['message' => 'Not found']);
                }
            } else {
                echo json_encode($persistence->getTours());
            }
        } 
        elseif ($method === 'POST') {
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input) throw new Exception("Invalid JSON");
            if (!isset($input['id'])) $input['id'] = 'tour-' . time();
            
            $saved = $persistence->saveTour($input);
            http_response_code(201);
            echo json_encode($saved);
        }
        elseif ($method === 'PUT') {
            if (!$id) throw new Exception("ID required");
            $input = json_decode(file_get_contents('php://input'), true);
            
            // Allow Upsert logic (similar to Node)
            $input['id'] = $id; 
            $saved = $persistence->saveTour($input);
            echo json_encode($saved);
        }
        elseif ($method === 'DELETE') {
            if (!$id) throw new Exception("ID required");
            $persistence->deleteTour($id);
            http_response_code(204);
        }
        exit;
    }
    
    // Default Root Response
    echo json_encode([
        'status' => 'ok',
        'persistence' => $persistenceMode,
        'storage' => $storageMode,
        'backend' => 'PHP'
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>