<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class ScreenManifest extends Model
{
    use HasUuids;

    /**
     * Indicates that the model's ID is not auto-incrementing.
     */
    public $incrementing = false;

    /**
     * The data type of the primary key.
     */
    protected $keyType = 'string';

    /**
     * Disable default timestamps (we only have manual created_at, no updated_at).
     */
    public $timestamps = false;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'screen_id',
        'version',
        'generated_at',
        'items',
        'total_spots',
        'remaining_spots',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'items' => 'array',
            'generated_at' => 'datetime',
        ];
    }

    /**
     * Get the screen that owns this manifest.
     */
    public function screen()
    {
        return $this->belongsTo(Screen::class);
    }
}
