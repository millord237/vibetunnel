const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const exe = b.addExecutable(.{
        .name = "vibetunnel-fwd",
        .root_source_file = .{ .path = "src/main.zig" },
        .target = target,
        .optimize = optimize,
    });
    exe.linkLibC();

    const options = b.addOptions();
    const version = b.option([]const u8, "version", "VibeTunnel version") orelse "unknown";
    options.addOption([]const u8, "version", version);
    exe.addOptions("build_options", options);

    b.installArtifact(exe);
}
